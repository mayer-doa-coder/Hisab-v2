// sync.test.ts — the sync layer's pure pieces and the event store's new sync
// surface. The end-to-end behaviour is covered by server/test/convergence.test.ts
// against a real server and real Postgres; these are the fast unit-level
// checks that do not need either.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backoffDelay, shouldRetry, type BackoffPolicy } from '../src/sync/backoff.ts';
import { CircuitBreaker } from '../src/sync/circuitBreaker.ts';
import { tick, tickReceive, decodeHlc, encodeHlc, Clock, ZERO_HLC_STATE } from '../src/data/clock.ts';
import { createTestStore } from './testEventStore.ts';

// -----------------------------------------------------------------------------
// backoff — AGENTS.md §3.1 discipline applied outside the domain: `random` is
// a parameter, so a retry policy is actually testable.
// -----------------------------------------------------------------------------

const POLICY: BackoffPolicy = { baseDelayMs: 1000, maxDelayMs: 8000, maxAttempts: 5 };

void test('backoff grows exponentially and is capped', () => {
  // random() === 1 gives the top of the full-jitter window, i.e. the cap itself.
  const atMax = (attempt: number): number => backoffDelay(attempt, POLICY, () => 0.999999);

  assert.ok(atMax(0) >= 999 && atMax(0) <= 1000, 'attempt 0 tops out near base');
  assert.ok(atMax(1) >= 1999 && atMax(1) <= 2000);
  assert.ok(atMax(2) >= 3999 && atMax(2) <= 4000);
  assert.ok(atMax(3) >= 7999 && atMax(3) <= 8000);
  assert.ok(atMax(9) <= 8000, 'never exceeds maxDelayMs however many attempts');
});

void test('backoff uses FULL jitter — the floor is zero at every attempt', () => {
  // Not "exponential plus a nudge". With many devices reconnecting after the
  // same tower outage, equal jitter leaves a synchronised floor that keeps
  // them stacked; full jitter spreads them across the whole window.
  for (const attempt of [0, 1, 2, 5]) {
    assert.equal(backoffDelay(attempt, POLICY, () => 0), 0);
  }
});

void test('shouldRetry stops at maxAttempts', () => {
  assert.equal(shouldRetry(4, POLICY), true);
  assert.equal(shouldRetry(5, POLICY), false);
});

// -----------------------------------------------------------------------------
// circuit breaker
// -----------------------------------------------------------------------------

void test('breaker opens after the threshold and half-opens after the reset window', () => {
  let now = 1000;
  const breaker = new CircuitBreaker({ failureThreshold: 3, resetAfterMs: 500 }, () => now);

  assert.equal(breaker.state(), 'CLOSED');
  assert.equal(breaker.canAttempt(), true);

  breaker.recordFailure();
  breaker.recordFailure();
  assert.equal(breaker.state(), 'CLOSED', 'below the threshold the circuit stays closed');

  breaker.recordFailure();
  assert.equal(breaker.state(), 'OPEN');
  assert.equal(breaker.canAttempt(), false, 'an open circuit stops the radio waking up');

  now += 499;
  assert.equal(breaker.state(), 'OPEN');

  now += 1;
  assert.equal(breaker.state(), 'HALF_OPEN');
  assert.equal(breaker.canAttempt(), true, 'half-open lets exactly one probe through');
});

void test('a successful probe closes the breaker; a failed one restarts the wait', () => {
  let now = 1000;
  const breaker = new CircuitBreaker({ failureThreshold: 2, resetAfterMs: 100 }, () => now);

  breaker.recordFailure();
  breaker.recordFailure();
  now += 100;
  assert.equal(breaker.state(), 'HALF_OPEN');

  breaker.recordSuccess();
  assert.equal(breaker.state(), 'CLOSED');
  assert.equal(breaker.consecutiveFailures(), 0);

  breaker.recordFailure();
  breaker.recordFailure();
  assert.equal(breaker.state(), 'OPEN');
  now += 100;
  assert.equal(breaker.state(), 'HALF_OPEN');
  breaker.recordFailure(); // the probe failed
  assert.equal(breaker.state(), 'OPEN', 'a failed probe restarts the full wait, not an immediate retry');
});

// -----------------------------------------------------------------------------
// HLC receive side — clock.ts flagged this as Step 10's job.
// -----------------------------------------------------------------------------

void test('tickReceive advances past a remote clock that is ahead', () => {
  const local = { l: 1000, c: 3 };
  const remote = { l: 5000, c: 0 };

  // Physical clock behind both — the interesting case, since l' comes from the
  // remote and the counter must follow the remote's, not the local's.
  const merged = tickReceive(local, remote, 900);
  assert.deepStrictEqual(merged, { l: 5000, c: 1 });
});

void test('tickReceive breaks a tie by taking the higher counter and incrementing', () => {
  assert.deepStrictEqual(tickReceive({ l: 5000, c: 4 }, { l: 5000, c: 9 }, 4000), { l: 5000, c: 10 });
  assert.deepStrictEqual(tickReceive({ l: 5000, c: 9 }, { l: 5000, c: 4 }, 4000), { l: 5000, c: 10 });
});

void test('tickReceive resets the counter when physical time overtakes both', () => {
  assert.deepStrictEqual(tickReceive({ l: 1000, c: 7 }, { l: 2000, c: 3 }, 9000), { l: 9000, c: 0 });
});

void test('a received hlc makes this device’s NEXT event sort after it', () => {
  // The property that matters: causality survives the fold. Without the
  // receive side, a device whose physical clock lags keeps minting hlcs that
  // sort BEFORE events it has already seen.
  let physical = 1_000_000; // deliberately far behind the remote below
  const clock = new Clock('device-a', ZERO_HLC_STATE, () => ++physical);

  const remoteHlc = encodeHlc({ l: 1_700_000_000_000, c: 0 }, 'device-b');
  clock.receive(remoteHlc);
  const next = clock.next();

  assert.ok(next > remoteHlc, `${next} must sort after ${remoteHlc}`);
  assert.equal(decodeHlc(next).deviceId, 'device-a');
});

void test('a malformed remote hlc is ignored, not thrown', () => {
  // It comes from an untrusted peer. One bad row must not abort a sync pass.
  const clock = new Clock('device-a', { l: 500, c: 2 }, () => 100);
  clock.receive('not-an-hlc');
  assert.deepStrictEqual(clock.getState(), { l: 500, c: 2 });
});

void test('tick and tickReceive agree on encoding order', () => {
  const a = encodeHlc(tick(ZERO_HLC_STATE, 1_700_000_000_000), 'device-a');
  const b = encodeHlc(tick({ l: 1_700_000_000_000, c: 0 }, 1_700_000_000_001), 'device-a');
  assert.ok(a < b, 'plain string comparison must match HLC order');
});

// -----------------------------------------------------------------------------
// event store sync surface — the sync_state indirection that keeps `events`
// INSERT-only (schema.ts, DECISIONS.md 2026-08-15).
// -----------------------------------------------------------------------------

void test('a freshly appended event is unsynced', async () => {
  const { store } = await createTestStore();

  await store.append('CUSTOMER_ADDED', {
    schema_version: 1,
    customer_id: 'c1',
    display_name: 'রহিম ভাই',
    phone: null,
  });

  const pending = await store.unsynced();
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.synced_at, null);
});

void test('markPushed writes sync_state and never touches the events row', async () => {
  const { store, db } = await createTestStore();

  const event = await store.append('CUSTOMER_ADDED', {
    schema_version: 1,
    customer_id: 'c1',
    display_name: 'রহিম ভাই',
    phone: null,
  });
  assert.ok(!('kind' in event));
  if ('kind' in event) return;

  await store.markPushed([event.id], 1_700_000_555_000);

  assert.equal((await store.unsynced()).length, 0, 'no longer pending');

  // The ledger row itself is untouched — EVENTS.md §1 invariant 1. The
  // effective value comes from the COALESCE in eventStore.ts's read path.
  const raw = await db.getAllAsync<{ synced_at: number | null }>(
    'SELECT synced_at FROM events WHERE id = ?',
    [event.id],
  );
  assert.equal(raw[0]?.synced_at, null, 'events.synced_at is still null — the transition lives in sync_state');

  const all = await store.allEvents();
  assert.equal(all[0]?.synced_at, 1_700_000_555_000, 'but the derived value reflects the push');
});

void test('merge inserts a remote event verbatim and is idempotent', async () => {
  const { store } = await createTestStore('device-a');

  const remote = {
    id: '01920000-0000-7000-8000-0000000000b1',
    device_id: 'device-b',
    seq: 1,
    hlc: '001700000000000-00000-device-b',
    shop_id: 'shop-1',
    type: 'CUSTOMER_ADDED',
    payload: { schema_version: 1, customer_id: 'c-remote', display_name: 'দর্জি', phone: null },
    created_at: 1_700_000_000_000,
    received_at: 1_700_000_100_000,
  };

  const first = await store.merge([remote]);
  assert.equal(first.inserted, 1);
  assert.equal(first.rejected.length, 0);

  const second = await store.merge([remote]);
  assert.equal(second.inserted, 0, 'idempotent on the device-generated id — no dedup table needed');
  assert.equal(second.duplicates, 1);

  const all = await store.allEvents();
  assert.equal(all.length, 1);
  // The envelope is the originating device's, never restamped — otherwise it
  // would no longer be the same event.
  assert.equal(all[0]?.device_id, 'device-b');
  assert.equal(all[0]?.hlc, '001700000000000-00000-device-b');
  assert.equal(all[0]?.synced_at, 1_700_000_100_000, 'came from the server, so synced by definition');
});

void test('merge rejects a remote event whose payload fails the shared schema', async () => {
  const { store } = await createTestStore();

  const result = await store.merge([
    {
      id: '01920000-0000-7000-8000-0000000000b2',
      device_id: 'device-b',
      seq: 1,
      hlc: '001700000000000-00000-device-b',
      shop_id: 'shop-1',
      type: 'CREDIT_GIVEN',
      payload: {
        schema_version: 1,
        entry_id: 'e1',
        customer_id: 'c1',
        amount_poisha: -1, // must be positive
        note: null,
        occurred_at: null,
      },
      created_at: 1_700_000_000_000,
      received_at: 1_700_000_100_000,
    },
  ]);

  assert.equal(result.inserted, 0);
  assert.equal(result.rejected.length, 1);
  assert.equal((await store.allEvents()).length, 0, 'nothing invalid is written');
});

void test('the pull cursor round-trips and starts at zero', async () => {
  const { store } = await createTestStore();
  assert.equal(await store.getCursor(), 0);
  await store.setCursor(42);
  assert.equal(await store.getCursor(), 42);
  await store.setCursor(97);
  assert.equal(await store.getCursor(), 97, 'one row, overwritten — not an append');
});
