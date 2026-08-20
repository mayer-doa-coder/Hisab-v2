// archiveCustomer.test.ts — apps/mobile/src/data/archiveCustomer.ts had NO
// test at all before this audit. Found and fixed in the same pass: the
// customer-event query it uses to decide "does this customer exist" was
// missing ENTRY_VOIDED events, which could make it treat a customer as
// existing when the full-log fold would not. This file locks that fix in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archiveCustomer } from '../src/data/archiveCustomer.ts';
import { createTestStore } from './testEventStore.ts';

void test('archiveCustomer succeeds for a real customer', async () => {
  const { db, store } = await createTestStore();
  const built = await store.append('CUSTOMER_ADDED', {
    schema_version: 1,
    customer_id: 'c1',
    display_name: 'রহিম ভাই',
    phone: null,
  });
  assert.ok(!('kind' in built));

  const result = await archiveCustomer(store, 'c1', 'REQUESTED');
  assert.deepEqual(result, { kind: 'OK' });

  const rows = await db.getAllAsync<{ archived: number }>('SELECT archived FROM customers WHERE id = ?', [
    'c1',
  ]);
  assert.equal(rows[0]?.archived, 1);
});

void test('archiveCustomer rejects a customer_id that was never added', async () => {
  const { db, store } = await createTestStore();
  const result = await archiveCustomer(store, 'ghost', 'REQUESTED');
  assert.deepEqual(result, { kind: 'UNKNOWN_CUSTOMER' });
});

void test('REGRESSION: a customer whose CUSTOMER_ADDED was voided is UNKNOWN, not archivable', async () => {
  // This is the exact scenario the missing-ENTRY_VOIDED bug got wrong: the
  // query used to select only events with a direct `customer_id` field,
  // which ENTRY_VOIDED's payload never has (it carries `voids_event_id`
  // instead). Without that event, the fold here would still see the
  // un-voided CUSTOMER_ADDED and wrongly report the customer as existing.
  const { db, store } = await createTestStore();

  const added = await store.append('CUSTOMER_ADDED', {
    schema_version: 1,
    customer_id: 'c1',
    display_name: 'ভুল করে যোগ করা',
    phone: null,
  });
  assert.ok(!('kind' in added));

  const voided = await store.append('ENTRY_VOIDED', {
    schema_version: 1,
    voids_event_id: added.id,
    reason: 'MISTAKE',
  });
  assert.ok(!('kind' in voided));

  // Sanity check on the premise: the real fold (via rebuildProjections, which
  // reads the whole log) must NOT show this customer as existing either.
  await store.rebuildProjections();
  const projected = await db.getAllAsync('SELECT 1 FROM customers WHERE id = ?', ['c1']);
  assert.equal(projected.length, 0, 'premise: the customer must not exist after rebuild');

  const result = await archiveCustomer(store, 'c1', 'REQUESTED');
  assert.deepEqual(result, { kind: 'UNKNOWN_CUSTOMER' });
});

void test('archiving an already-archived customer succeeds (idempotent), and ENTRY_VOIDED events for other fields do not confuse it', async () => {
  const { db, store } = await createTestStore();
  await store.append('CUSTOMER_ADDED', {
    schema_version: 1,
    customer_id: 'c1',
    display_name: 'করিম',
    phone: null,
  });
  const credit = await store.append('CREDIT_GIVEN', {
    schema_version: 1,
    entry_id: 'e1',
    customer_id: 'c1',
    amount_poisha: 5000,
    note: null,
    occurred_at: null,
  });
  assert.ok(!('kind' in credit));
  // Void the credit, not the customer — the customer must still be archivable.
  await store.append('ENTRY_VOIDED', {
    schema_version: 1,
    voids_event_id: credit.id,
    reason: 'MISTAKE',
  });

  const first = await archiveCustomer(store, 'c1', 'INACTIVE');
  assert.deepEqual(first, { kind: 'OK' });

  const second = await archiveCustomer(store, 'c1', 'REQUESTED');
  assert.deepEqual(second, { kind: 'OK' }, 'archiving twice must not error');
});
