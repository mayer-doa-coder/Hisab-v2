// eventStore.test.ts — append() -> read back -> matches what was written,
// and since(seq) returns exactly the expected subset.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestStore } from './testEventStore.ts';

void test('append() writes a row that reads back with the same fields', async () => {
  const { store, db } = await createTestStore();

  const result = await store.append('CUSTOMER_ADDED', {
    schema_version: 1,
    customer_id: 'c1',
    display_name: 'Rahim',
    phone: null,
  });

  assert.ok(!('kind' in result), 'expected a built event, not a ValidationError');
  if ('kind' in result) return;

  const rows = await db.getAllAsync<{ id: string; type: string; payload: string }>(
    'SELECT id, type, payload FROM events WHERE id = ?',
    [result.id],
  );
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.ok(row !== undefined);
  assert.equal(row.type, 'CUSTOMER_ADDED');
  assert.deepStrictEqual(JSON.parse(row.payload), {
    schema_version: 1,
    customer_id: 'c1',
    display_name: 'Rahim',
    phone: null,
  });
});

void test('append() rejects an invalid payload and writes nothing', async () => {
  const { store, db } = await createTestStore();

  const result = await store.append('CREDIT_GIVEN', {
    schema_version: 1,
    entry_id: 'e1',
    customer_id: 'c1',
    amount_poisha: -500, // invalid — must be positive
    note: null,
    occurred_at: null,
  });

  assert.ok('kind' in result, 'expected a ValidationError for a negative amount');

  const rows = await db.getAllAsync('SELECT * FROM events', []);
  assert.equal(rows.length, 0, 'an invalid payload must not be written');
});

void test('append() updates the customers/balances projection via a re-fold', async () => {
  const { store, db } = await createTestStore();

  await store.append('CUSTOMER_ADDED', {
    schema_version: 1,
    customer_id: 'c1',
    display_name: 'Rahim',
    phone: null,
  });
  await store.append('CREDIT_GIVEN', {
    schema_version: 1,
    entry_id: 'e1',
    customer_id: 'c1',
    amount_poisha: 5000,
    note: null,
    occurred_at: null,
  });

  const balanceRows = await db.getAllAsync<{ balance_poisha: number }>(
    'SELECT balance_poisha FROM balances WHERE customer_id = ?',
    ['c1'],
  );
  assert.equal(balanceRows.length, 1);
  assert.equal(balanceRows[0]?.balance_poisha, 5000);
});

void test('concurrent append() calls before the first resolves still get distinct seq values', async () => {
  // Regression test: nextSeq() used to cache MAX(seq) via a lazy
  // `if (cached === null) { cached = await read() }` check. Two calls
  // launched before either's read resolved both saw `null`, both read the
  // same MAX(seq), and both returned the same seq — reproduced directly
  // against the old implementation before this fix. Credit entry is the
  // highest-frequency action in the app; a rapid double-tap is exactly
  // this scenario.
  const { store } = await createTestStore();

  const results = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      store.append('CUSTOMER_ADDED', {
        schema_version: 1,
        customer_id: `concurrent-${i}`,
        display_name: `Concurrent ${i}`,
        phone: null,
      }),
    ),
  );

  const seqValues = results.map((r) => {
    assert.ok(!('kind' in r), 'every concurrent append must validate successfully');
    return 'kind' in r ? -1 : r.seq;
  });

  assert.deepStrictEqual(
    [...seqValues].sort((a, b) => a - b),
    [1, 2, 3, 4, 5],
    `concurrent appends must get distinct, monotonic seq values — got ${JSON.stringify(seqValues)}`,
  );
});

void test('since(seq) returns exactly the events with seq greater than the given value', async () => {
  const { store, deviceId } = await createTestStore();

  const written = [];
  for (let i = 0; i < 5; i++) {
    const result = await store.append('CUSTOMER_ADDED', {
      schema_version: 1,
      customer_id: `c${i}`,
      display_name: `Customer ${i}`,
      phone: null,
    });
    assert.ok(!('kind' in result));
    if (!('kind' in result)) written.push(result);
  }

  const seqValues = written.map((e) => e.seq);
  assert.deepStrictEqual(seqValues, [1, 2, 3, 4, 5], 'seq must be monotonic per device, starting at 1');

  const since2 = await store.since(2);
  assert.deepStrictEqual(
    since2.map((e) => e.seq),
    [3, 4, 5],
    'since(2) must return exactly seq 3, 4, 5 — no more, no less',
  );

  const since0 = await store.since(0);
  assert.equal(since0.length, 5, 'since(0) must return every event for this device');

  const since5 = await store.since(5);
  assert.equal(since5.length, 0, 'since(5) must return nothing when nothing is newer');

  for (const event of since2) {
    assert.equal(event.device_id, deviceId);
  }
});
