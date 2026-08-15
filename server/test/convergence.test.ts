// convergence.test.ts — BUILD_PLAN.md Phase 3: "Two-device convergence test
// as a CI job, not a manual check. Two simulated devices, both offline, both
// editing, both reconnecting → identical state or a clearly surfaced review
// item."
//
// This is the step's centerpiece and Phase 3's exit criterion. Everything in
// it is real — real event store, real HLC clocks, real sync engine, real
// server, real Postgres (see device.ts). The two assertions it exists for:
//
//   HAPPY PATH   both devices fold to identical state after syncing
//   CONFLICT PATH a duplicate payment made independently on both devices
//                survives as TWO events in the merged log (nothing is
//                silently deduplicated at the event level) AND
//                detectAnomalies flags DUPLICATE_SUSPECTED on both devices
//
// The conflict path is the one that would break if SECURITY.md §5's old
// "a payment cannot exceed the outstanding balance" rule were reinstated —
// the second device's payment would be refused at push and would never reach
// the first. That is the regression check described in this step's report.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { detectAnomalies, fold } from '@hisab/domain';
import type { AnyEvent, LedgerState } from '@hisab/domain';
import { Api } from '../../apps/mobile/src/sync/api';
import { closePool, resetDatabase, SKIP_WITHOUT_DB, startTestServer, type RunningServer } from './pg';
import { createDevice, type SimulatedDevice } from './device';

let server: RunningServer | null = null;

before(async () => {
  if (SKIP_WITHOUT_DB !== false) return;
  server = await startTestServer();
});

after(async () => {
  await server?.close();
  await closePool();
});

beforeEach(async () => {
  if (SKIP_WITHOUT_DB !== false) return;
  await resetDatabase();
});

/** Registers one shop and brings up two devices sharing it, each with its own identity and clock. */
async function twoDevices(baseUrl: string, phone: string): Promise<[SimulatedDevice, SimulatedDevice]> {
  const tokens = await new Api({ baseUrl }).register(phone, '135790');

  const a = await createDevice({
    deviceId: 'device-a',
    shopId: tokens.shop_id,
    baseUrl,
    tokens,
    clockStart: 1_700_000_000_000,
    randomSeed: 11,
  });
  // Offset base clock and a different random seed: the two devices must not
  // be in lockstep, or the test would prove ordering works only for clocks
  // that happen to agree.
  const b = await createDevice({
    deviceId: 'device-b',
    shopId: tokens.shop_id,
    baseUrl,
    tokens,
    clockStart: 1_700_000_007_500,
    randomSeed: 29,
  });

  return [a, b];
}

/** Push then pull, on both devices, twice — so each sees what the other pushed. */
async function syncBoth(a: SimulatedDevice, b: SimulatedDevice): Promise<void> {
  await a.engine.syncOnce();
  await b.engine.syncOnce();
  // Second round: A's first pass ran before B had pushed anything, so A needs
  // another pull to see B's events. This is what the background task does on
  // its next tick; the test just does not wait two minutes for it.
  await a.engine.syncOnce();
  await b.engine.syncOnce();
}

function balanceOf(state: LedgerState, customerId: string): number {
  return state.balances.get(customerId)?.balance_poisha ?? 0;
}

/**
 * Compares folded state without the device-local fields. `pendingCustomerIds`
 * is deliberately excluded: EVENTS.md §6 and DECISIONS.md 2026-08-08 say sync
 * state is per-device and MUST differ between two devices. Asserting it were
 * equal would be asserting a bug.
 */
function comparableState(state: LedgerState): unknown {
  return {
    customers: [...state.customers.entries()].sort(([x], [y]) => x.localeCompare(y)),
    balances: [...state.balances.entries()].sort(([x], [y]) => x.localeCompare(y)),
    voided: [...state.voided].sort(),
  };
}

// =============================================================================
// HAPPY PATH
// =============================================================================

void test(
  'happy path: two devices editing offline converge to identical folded state',
  { skip: SKIP_WITHOUT_DB },
  async () => {
    assert.ok(server !== null);
    const [a, b] = await twoDevices(server.baseUrl, '01700000001');

    // ---- Both offline, both editing -----------------------------------------
    // Device A adds two customers and records credit against them.
    await a.store.append('CUSTOMER_ADDED', {
      schema_version: 1,
      customer_id: 'cust-rahim',
      display_name: 'রহিম ভাই',
      phone: null,
    });
    await a.store.append('CREDIT_GIVEN', {
      schema_version: 1,
      entry_id: 'entry-a1',
      customer_id: 'cust-rahim',
      amount_poisha: 50_000, // ৳500
      note: null,
      occurred_at: null,
    });

    // Device B, with no knowledge of A, adds a different customer and records
    // a payment against A's customer — it has not seen that customer yet, and
    // it does not need to. Events are self-contained (EVENTS.md §1 invariant 5).
    await b.store.append('CUSTOMER_ADDED', {
      schema_version: 1,
      customer_id: 'cust-tailor',
      display_name: 'দর্জি',
      phone: null,
    });
    await b.store.append('PAYMENT_RECEIVED', {
      schema_version: 1,
      entry_id: 'entry-b1',
      customer_id: 'cust-rahim',
      amount_poisha: 20_000, // ৳200
      note: null,
      occurred_at: null,
    });

    // ---- Both reconnect ------------------------------------------------------
    await syncBoth(a, b);

    const eventsA = await a.store.allEvents();
    const eventsB = await b.store.allEvents();

    assert.equal(eventsA.length, 4, 'device A should hold all four events after sync');
    assert.equal(eventsB.length, 4, 'device B should hold all four events after sync');

    const stateA = fold(eventsA);
    const stateB = fold(eventsB);

    // THE ASSERTION. Identical folded state, from two devices that generated
    // their events independently with unsynchronised clocks.
    assert.deepStrictEqual(
      comparableState(stateA),
      comparableState(stateB),
      'both devices must fold to identical state',
    );

    // And the state is actually right, not just identically wrong.
    assert.equal(balanceOf(stateA, 'cust-rahim'), 30_000, '৳500 credit minus ৳200 payment = ৳300');
    assert.equal(stateA.customers.size, 2);
    assert.equal(stateA.customers.get('cust-rahim')?.display_name, 'রহিম ভাই');
    assert.equal(stateA.customers.get('cust-tailor')?.display_name, 'দর্জি');

    // Sync state is per-device and legitimately differs — but after a full
    // round trip both devices should consider everything settled.
    assert.equal((await a.store.unsynced()).length, 0, 'A has nothing left to push');
    assert.equal((await b.store.unsynced()).length, 0, 'B has nothing left to push');
  },
);

void test(
  'happy path: re-syncing is idempotent and does not duplicate events',
  { skip: SKIP_WITHOUT_DB },
  async () => {
    assert.ok(server !== null);
    const [a, b] = await twoDevices(server.baseUrl, '01700000002');

    await a.store.append('CUSTOMER_ADDED', {
      schema_version: 1,
      customer_id: 'cust-1',
      display_name: 'চেয়ারম্যান সাহেব',
      phone: null,
    });

    await syncBoth(a, b);
    const afterFirst = (await b.store.allEvents()).length;

    // Idempotency comes from the device-generated UUID plus ON CONFLICT DO
    // NOTHING (AGENTS.md §7) — no dedup table on either side. Running the
    // whole exchange again must change nothing.
    await syncBoth(a, b);
    await syncBoth(a, b);

    assert.equal((await b.store.allEvents()).length, afterFirst, 're-syncing must not duplicate events');
    assert.equal((await a.store.allEvents()).length, afterFirst);
  },
);

// =============================================================================
// CONFLICT PATH — EVENTS.md §8's own worked example
// =============================================================================

void test(
  'conflict path: a duplicate payment made on both devices survives as two events and is flagged',
  { skip: SKIP_WITHOUT_DB },
  async () => {
    assert.ok(server !== null);
    const [a, b] = await twoDevices(server.baseUrl, '01700000003');

    // Set up a ৳500 balance that both devices know about.
    await a.store.append('CUSTOMER_ADDED', {
      schema_version: 1,
      customer_id: 'cust-rahim',
      display_name: 'রহিম ভাই',
      phone: null,
    });
    await a.store.append('CREDIT_GIVEN', {
      schema_version: 1,
      entry_id: 'entry-credit',
      customer_id: 'cust-rahim',
      amount_poisha: 50_000, // ৳500
      note: null,
      occurred_at: null,
    });
    await syncBoth(a, b);

    // ---- Now both go offline and both record the SAME payment ---------------
    // EVENTS.md §8: "two devices are offline and both record a ৳500 payment
    // against a ৳500 balance. Both events are individually valid; together
    // they overpay." This is the shopkeeper and their helper each recording
    // the same cash — a real thing that happens at a counter, not a fault.
    //
    // `occurred_at` is set to the same instant on both, because that is what
    // makes them a duplicate: same customer, same amount, close together.
    const paidAt = 1_700_000_100_000;

    await a.store.append('PAYMENT_RECEIVED', {
      schema_version: 1,
      entry_id: 'entry-pay-a',
      customer_id: 'cust-rahim',
      amount_poisha: 50_000,
      note: null,
      occurred_at: paidAt,
    });
    await b.store.append('PAYMENT_RECEIVED', {
      schema_version: 1,
      entry_id: 'entry-pay-b',
      customer_id: 'cust-rahim',
      amount_poisha: 50_000,
      occurred_at: paidAt + 30_000, // 30s apart — inside the 5-minute window
      note: null,
    });

    // ---- Both reconnect ------------------------------------------------------
    await syncBoth(a, b);

    const eventsA = await a.store.allEvents();
    const eventsB = await b.store.allEvents();

    // ASSERTION 1: BOTH payments genuinely exist. Nothing was silently
    // deduplicated at the event level, and — critically — the server did NOT
    // refuse the second one for overdrawing the balance. The event log records
    // what happened; it does not adjudicate it.
    const paymentsA = eventsA.filter((e: AnyEvent) => e.type === 'PAYMENT_RECEIVED');
    const paymentsB = eventsB.filter((e: AnyEvent) => e.type === 'PAYMENT_RECEIVED');

    assert.equal(paymentsA.length, 2, 'device A must hold BOTH payment events, not a deduplicated one');
    assert.equal(paymentsB.length, 2, 'device B must hold BOTH payment events, not a deduplicated one');

    const idsA = new Set(paymentsA.map((e) => e.id));
    const idsB = new Set(paymentsB.map((e) => e.id));
    assert.deepStrictEqual([...idsA].sort(), [...idsB].sort(), 'both devices hold the same two payment ids');

    // Both devices still converge — a conflict is not a divergence.
    assert.deepStrictEqual(
      comparableState(fold(eventsA)),
      comparableState(fold(eventsB)),
      'devices must converge even when the merged log contains a conflict',
    );

    // The balance really is negative: ৳500 credit, ৳1000 of payments.
    assert.equal(balanceOf(fold(eventsA), 'cust-rahim'), -50_000);

    // ASSERTION 2: detectAnomalies flags it, on BOTH devices' folded view.
    const anomaliesA = detectAnomalies(fold(eventsA), eventsA);
    const anomaliesB = detectAnomalies(fold(eventsB), eventsB);

    const duplicateA = anomaliesA.filter((x) => x.kind === 'DUPLICATE_SUSPECTED');
    const duplicateB = anomaliesB.filter((x) => x.kind === 'DUPLICATE_SUSPECTED');

    assert.equal(duplicateA.length, 1, 'device A must flag DUPLICATE_SUSPECTED');
    assert.equal(duplicateB.length, 1, 'device B must flag DUPLICATE_SUSPECTED');

    const flaggedA = duplicateA[0];
    assert.ok(flaggedA !== undefined && flaggedA.kind === 'DUPLICATE_SUSPECTED');
    assert.deepStrictEqual(
      flaggedA.events.map((e) => e.id).sort(),
      [...idsA].sort(),
      'the flagged pair must be the two payment events themselves',
    );

    // The negative balance is surfaced too — this is the review screen's
    // input (BUILD_PLAN Phase 3, B's task): both candidates side by side,
    // one tap to void one.
    assert.ok(
      anomaliesA.some((x) => x.kind === 'NEGATIVE_BALANCE' && x.customer_id === 'cust-rahim'),
      'the overdrawn balance must also be surfaced as an anomaly',
    );
  },
);

void test(
  'conflict path: voiding one duplicate on one device converges and clears the anomaly',
  { skip: SKIP_WITHOUT_DB },
  async () => {
    assert.ok(server !== null);
    const [a, b] = await twoDevices(server.baseUrl, '01700000004');

    await a.store.append('CUSTOMER_ADDED', {
      schema_version: 1,
      customer_id: 'cust-1',
      display_name: 'রহিম ভাই',
      phone: null,
    });
    await a.store.append('CREDIT_GIVEN', {
      schema_version: 1,
      entry_id: 'e-credit',
      customer_id: 'cust-1',
      amount_poisha: 50_000,
      note: null,
      occurred_at: null,
    });
    await syncBoth(a, b);

    const paidAt = 1_700_000_200_000;
    const payA = await a.store.append('PAYMENT_RECEIVED', {
      schema_version: 1,
      entry_id: 'e-pay-a',
      customer_id: 'cust-1',
      amount_poisha: 50_000,
      note: null,
      occurred_at: paidAt,
    });
    await b.store.append('PAYMENT_RECEIVED', {
      schema_version: 1,
      entry_id: 'e-pay-b',
      customer_id: 'cust-1',
      amount_poisha: 50_000,
      note: null,
      occurred_at: paidAt + 1_000,
    });
    await syncBoth(a, b);

    assert.ok(!('kind' in payA));
    if ('kind' in payA) return;

    // The shopkeeper resolves it: one tap on the review screen voids one.
    // ENTRY_VOIDED is the only correction mechanism (EVENTS.md §3).
    await b.store.append('ENTRY_VOIDED', {
      schema_version: 1,
      voids_event_id: payA.id,
      reason: 'DUPLICATE',
    });
    await syncBoth(a, b);

    const eventsA = await a.store.allEvents();
    const eventsB = await b.store.allEvents();
    const stateA = fold(eventsA);

    assert.deepStrictEqual(
      comparableState(stateA),
      comparableState(fold(eventsB)),
      'devices converge after the correction, resolved on the other device',
    );

    // The voided payment is still in the log — nothing was deleted — but it
    // no longer counts toward the balance.
    assert.equal(eventsA.filter((e) => e.type === 'PAYMENT_RECEIVED').length, 2, 'nothing is removed from the log');
    assert.ok(stateA.voided.has(payA.id));
    assert.equal(balanceOf(stateA, 'cust-1'), 0, '৳500 credit minus one surviving ৳500 payment');

    // With the duplicate voided, neither anomaly should remain.
    const anomalies = detectAnomalies(stateA, eventsA);
    assert.equal(
      anomalies.filter((x) => x.kind === 'DUPLICATE_SUSPECTED').length,
      0,
      'voiding one of the pair clears the duplicate flag',
    );
    assert.equal(anomalies.filter((x) => x.kind === 'NEGATIVE_BALANCE').length, 0);
  },
);
