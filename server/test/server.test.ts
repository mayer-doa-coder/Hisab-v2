// server.test.ts — the endpoints, auth, and the validation boundary.
//
// The load-bearing test in this file is the last one: the server accepts a
// payment that overdraws the balance. That is docs/SECURITY.md §5 as
// corrected on 2026-08-15, and it is the behaviour the convergence test's
// conflict path depends on.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Api, ApiError } from '../../apps/mobile/src/sync/api';
import { MAX_MONEY_MAGNITUDE } from '../src/validate';
import { closePool, resetDatabase, SKIP_WITHOUT_DB, startTestServer, type RunningServer } from './pg';

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

function api(): Api {
  assert.ok(server !== null);
  return new Api({ baseUrl: server.baseUrl });
}

/** A well-formed envelope, so each test only has to vary the part it cares about. */
function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '01920000-0000-7000-8000-000000000001',
    device_id: 'device-x',
    seq: 1,
    hlc: '001700000000000-00000-device-x',
    shop_id: 'REPLACED-BY-TEST',
    type: 'CUSTOMER_ADDED',
    payload: { schema_version: 1, customer_id: 'c1', display_name: 'রহিম ভাই', phone: null },
    created_at: 1_700_000_000_000,
    ...overrides,
  };
}

// -----------------------------------------------------------------------------
// health + auth
// -----------------------------------------------------------------------------

void test('health touches the database', { skip: SKIP_WITHOUT_DB }, async () => {
  assert.equal(await api().health(), true);
});

void test('login succeeds with the right PIN and fails with the wrong one', { skip: SKIP_WITHOUT_DB }, async () => {
  const client = api();
  await client.register('01711111111', '246810', 'device-1');

  const tokens = await client.login('01711111111', '246810', 'device-1');
  assert.ok(tokens.access_token.length > 0);
  assert.ok(tokens.refresh_token.length > 0);
  assert.ok(tokens.access_expires_at > Date.now());

  await assert.rejects(
    () => client.login('01711111111', '999999', 'device-1'),
    (error: unknown) => error instanceof ApiError && error.status === 401,
  );
});

void test('an unknown phone fails identically to a wrong PIN', { skip: SKIP_WITHOUT_DB }, async () => {
  // Not a phone-number oracle: both paths return the same code, so the
  // endpoint cannot be used to enumerate which numbers have accounts.
  await assert.rejects(
    () => api().login('01799999999', '123456', 'device-1'),
    (error: unknown) => error instanceof ApiError && error.status === 401,
  );
});

void test('refresh mints a new access token; logout revokes', { skip: SKIP_WITHOUT_DB }, async () => {
  const client = api();
  const tokens = await client.register('01722222222', '112233', 'device-1');

  const refreshed = await client.refresh(tokens.refresh_token, 'device-1');
  assert.ok(refreshed.access_token.length > 0);
  assert.equal(refreshed.shop_id, tokens.shop_id);

  await client.logout(refreshed.access_token);

  // After logout every token for the shop is gone, including the refresh one.
  await assert.rejects(
    () => client.refresh(tokens.refresh_token, 'device-1'),
    (error: unknown) => error instanceof ApiError && error.status === 401,
  );
});

void test('the events endpoints reject an absent or bogus token', { skip: SKIP_WITHOUT_DB }, async () => {
  const client = api();
  await assert.rejects(
    () => client.pull('not-a-real-token', 0),
    (error: unknown) => error instanceof ApiError && error.status === 401,
  );
});

// -----------------------------------------------------------------------------
// push / pull
// -----------------------------------------------------------------------------

void test('push is idempotent on the device-generated id', { skip: SKIP_WITHOUT_DB }, async () => {
  const client = api();
  const tokens = await client.register('01733333333', '445566', 'device-1');
  const event = envelope({ shop_id: tokens.shop_id });

  const first = await client.push(tokens.access_token, [event]);
  assert.deepStrictEqual(first.accepted, [event.id]);
  assert.deepStrictEqual(first.duplicates, []);

  // AGENTS.md §7: ON CONFLICT (id) DO NOTHING is the whole mechanism. No
  // idempotency hash table, no TTL.
  const second = await client.push(tokens.access_token, [event]);
  assert.deepStrictEqual(second.accepted, []);
  assert.deepStrictEqual(second.duplicates, [event.id]);

  const pulled = await client.pull(tokens.access_token, 0);
  assert.equal(pulled.events.length, 1, 'the event is stored exactly once');
});

void test('a shop cannot write an event into another shop', { skip: SKIP_WITHOUT_DB }, async () => {
  const client = api();
  const mine = await client.register('01744444444', '556677', 'device-1');
  const theirs = await client.register('01755555555', '667788', 'device-1');

  const result = await client.push(mine.access_token, [envelope({ shop_id: theirs.shop_id })]);
  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected[0]?.reason, 'WRONG_SHOP');
});

void test('a shop cannot read another shop’s events', { skip: SKIP_WITHOUT_DB }, async () => {
  const client = api();
  const mine = await client.register('01766666666', '778899', 'device-1');
  const theirs = await client.register('01777777777', '889900', 'device-1');

  await client.push(mine.access_token, [envelope({ shop_id: mine.shop_id })]);

  // SECURITY.md §5: enforced in the query, not in application logic.
  const pulled = await client.pull(theirs.access_token, 0);
  assert.equal(pulled.events.length, 0);
});

void test('the batch cap is enforced', { skip: SKIP_WITHOUT_DB }, async () => {
  const client = api();
  const tokens = await client.register('01788888888', '990011', 'device-1');

  const tooMany = Array.from({ length: 501 }, (_, i) =>
    envelope({ shop_id: tokens.shop_id, id: `01920000-0000-7000-8000-${String(i).padStart(12, '0')}`, seq: i + 1 }),
  );

  await assert.rejects(
    () => client.push(tokens.access_token, tooMany),
    (error: unknown) => error instanceof ApiError && error.status === 413,
  );
});

void test('pull returns events after the cursor, in server_seq order', { skip: SKIP_WITHOUT_DB }, async () => {
  const client = api();
  const tokens = await client.register('01799000000', '101112', 'device-1');

  const events = [1, 2, 3].map((n) =>
    envelope({
      shop_id: tokens.shop_id,
      id: `01920000-0000-7000-8000-00000000000${n}`,
      seq: n,
      payload: { schema_version: 1, customer_id: `c${n}`, display_name: `x${n}`, phone: null },
    }),
  );
  await client.push(tokens.access_token, events);

  const all = await client.pull(tokens.access_token, 0);
  assert.equal(all.events.length, 3);

  const after = await client.pull(tokens.access_token, all.events[0]?.server_seq ?? 0);
  assert.equal(after.events.length, 2, 'the cursor excludes what was already read');
});

// -----------------------------------------------------------------------------
// validation — what the server DOES and DOES NOT reject
// -----------------------------------------------------------------------------

void test('a malformed envelope is rejected per-event, not per-batch', { skip: SKIP_WITHOUT_DB }, async () => {
  const client = api();
  const tokens = await client.register('01799111111', '121314', 'device-1');

  const good = envelope({ shop_id: tokens.shop_id });
  const bad = envelope({ shop_id: tokens.shop_id, id: 'not-a-uuid', seq: 2 });

  const result = await client.push(tokens.access_token, [good, bad]);
  assert.deepStrictEqual(result.accepted, [good.id], 'the valid event still lands');
  assert.equal(result.rejected[0]?.reason, 'BAD_ID');
});

void test('a payload failing the shared Zod schema is rejected', { skip: SKIP_WITHOUT_DB }, async () => {
  const client = api();
  const tokens = await client.register('01799222222', '131415', 'device-1');

  // amount_poisha must be a positive integer — enforced by the SAME schema
  // the client writes with (packages/domain/src/events.ts), not a second
  // server-side copy of the rule (AGENTS.md §4.3).
  const result = await client.push(tokens.access_token, [
    envelope({
      shop_id: tokens.shop_id,
      type: 'CREDIT_GIVEN',
      payload: {
        schema_version: 1,
        entry_id: 'e1',
        customer_id: 'c1',
        amount_poisha: -500,
        note: null,
        occurred_at: null,
      },
    }),
  ]);

  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected[0]?.reason, 'SCHEMA');
});

void test('an absurd amount is rejected — a per-event bound, not a state check', { skip: SKIP_WITHOUT_DB }, async () => {
  const client = api();
  const tokens = await client.register('01799333333', '141516', 'device-1');

  const result = await client.push(tokens.access_token, [
    envelope({
      shop_id: tokens.shop_id,
      type: 'CREDIT_GIVEN',
      payload: {
        schema_version: 1,
        entry_id: 'e1',
        customer_id: 'c1',
        amount_poisha: MAX_MONEY_MAGNITUDE + 1,
        note: null,
        occurred_at: null,
      },
    }),
  ]);

  assert.equal(result.rejected[0]?.reason, 'ABSURD_AMOUNT');
});

// -----------------------------------------------------------------------------
// THE ONE THAT MATTERS — docs/SECURITY.md §5, corrected 2026-08-15
// -----------------------------------------------------------------------------

void test(
  'the server ACCEPTS a payment that exceeds the outstanding balance',
  { skip: SKIP_WITHOUT_DB },
  async () => {
    const client = api();
    const tokens = await client.register('01799444444', '151617', 'device-1');

    // ৳500 of credit...
    const credit = envelope({
      shop_id: tokens.shop_id,
      id: '01920000-0000-7000-8000-0000000000a1',
      seq: 1,
      type: 'CREDIT_GIVEN',
      payload: {
        schema_version: 1,
        entry_id: 'e-credit',
        customer_id: 'cust-1',
        amount_poisha: 50_000,
        note: null,
        occurred_at: null,
      },
    });

    // ...and ৳900 of payment against it. Overdraws by ৳400.
    const overpayment = envelope({
      shop_id: tokens.shop_id,
      id: '01920000-0000-7000-8000-0000000000a2',
      seq: 2,
      type: 'PAYMENT_RECEIVED',
      payload: {
        schema_version: 1,
        entry_id: 'e-pay',
        customer_id: 'cust-1',
        amount_poisha: 90_000,
        note: null,
        occurred_at: null,
      },
    });

    const result = await client.push(tokens.access_token, [credit, overpayment]);

    // Both accepted. The cash crossed the counter; rejecting the event would
    // not un-cross it, it would only make the ledger disagree with the shop.
    // EVENTS.md §8: "Anomaly detection never blocks a write." The overdraw is
    // surfaced by detectAnomalies AFTER the fold, on the device, to the
    // shopkeeper who knows what actually happened.
    assert.deepStrictEqual(
      [...result.accepted].sort(),
      [credit.id, overpayment.id].sort(),
      'the server must not reject an event for conflicting with derived state',
    );
    assert.equal(result.rejected.length, 0);
  },
);
