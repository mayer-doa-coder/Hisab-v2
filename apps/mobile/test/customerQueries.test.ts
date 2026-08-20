// customerQueries.test.ts — listCustomerRows, getCustomerRow, getHomeVM.
// Reads against the real customers/balances projection tables, kept correct
// by eventStore.ts's own writeProjection() after every append().

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Poisha } from '@hisab/domain';
import { getCustomerRow, getHomeVM, listCustomerRows } from '../src/data/customerQueries.ts';
import { createFormatter } from '../src/i18n/formatter.ts';
import { createTestStore } from './testEventStore.ts';

const format = createFormatter('bn', 'arabic');
const NOW = Date.now();

void test('listCustomerRows: recent-first, archived excluded', async () => {
  const { db, store } = await createTestStore();

  await store.append('CUSTOMER_ADDED', {
    schema_version: 1,
    customer_id: 'old',
    display_name: 'পুরনো',
    phone: null,
  });
  await store.append('CREDIT_GIVEN', {
    schema_version: 1,
    entry_id: 'e1',
    customer_id: 'old',
    amount_poisha: 10_000,
    note: null,
    occurred_at: NOW - 5000,
  });

  await store.append('CUSTOMER_ADDED', {
    schema_version: 1,
    customer_id: 'recent',
    display_name: 'নতুন',
    phone: null,
  });
  await store.append('CREDIT_GIVEN', {
    schema_version: 1,
    entry_id: 'e2',
    customer_id: 'recent',
    amount_poisha: 20_000,
    note: null,
    occurred_at: NOW,
  });

  await store.append('CUSTOMER_ADDED', {
    schema_version: 1,
    customer_id: 'gone',
    display_name: 'আর্কাইভড',
    phone: null,
  });
  await store.append('CUSTOMER_ARCHIVED', { schema_version: 1, customer_id: 'gone', reason: 'REQUESTED' });

  const rows = await listCustomerRows(db, NOW, format);
  assert.deepEqual(
    rows.map((r) => r.id),
    ['recent', 'old'],
  );
});

void test('getCustomerRow: null for an unknown or archived customer', async () => {
  const { db, store } = await createTestStore();
  await store.append('CUSTOMER_ADDED', {
    schema_version: 1,
    customer_id: 'c1',
    display_name: 'করিম',
    phone: null,
  });
  await store.append('CUSTOMER_ARCHIVED', { schema_version: 1, customer_id: 'c1', reason: 'REQUESTED' });

  assert.equal(await getCustomerRow(db, 'c1', NOW, format), null);
  assert.equal(await getCustomerRow(db, 'ghost', NOW, format), null);
});

void test('getCustomerRow: syncPending reflects an unsynced write for THIS customer, not another one', async () => {
  const { db, store } = await createTestStore();
  const syncedAdd = await store.append('CUSTOMER_ADDED', {
    schema_version: 1,
    customer_id: 'synced',
    display_name: 'রহিম',
    phone: null,
  });
  assert.ok(!('kind' in syncedAdd));
  // Every local write starts unsynced (synced_at: null) — this is the one
  // that gets marked pushed, so the two customers are genuinely different.
  await store.markPushed([syncedAdd.id], NOW);

  await store.append('CUSTOMER_ADDED', {
    schema_version: 1,
    customer_id: 'pending',
    display_name: 'করিম',
    phone: null,
  });
  await store.append('CREDIT_GIVEN', {
    schema_version: 1,
    entry_id: 'e1',
    customer_id: 'pending',
    amount_poisha: 10_000,
    note: null,
    occurred_at: NOW,
  });

  const synced = await getCustomerRow(db, 'synced', NOW, format);
  const pending = await getCustomerRow(db, 'pending', NOW, format);
  assert.equal(synced?.syncPending, false);
  assert.equal(pending?.syncPending, true);
});

void test('getHomeVM: totals only positive balances and excludes voided entries', async () => {
  const { db, store } = await createTestStore();

  await store.append('CUSTOMER_ADDED', {
    schema_version: 1,
    customer_id: 'c1',
    display_name: 'রহিম',
    phone: null,
  });
  await store.append('CREDIT_GIVEN', {
    schema_version: 1,
    entry_id: 'e1',
    customer_id: 'c1',
    amount_poisha: 50_000,
    note: null,
    occurred_at: NOW,
  });

  await store.append('CUSTOMER_ADDED', {
    schema_version: 1,
    customer_id: 'c2',
    display_name: 'সালমা',
    phone: null,
  });
  await store.append('CREDIT_GIVEN', {
    schema_version: 1,
    entry_id: 'e2',
    customer_id: 'c2',
    amount_poisha: 90_000,
    note: null,
    occurred_at: NOW,
  });
  await store.append('PAYMENT_RECEIVED', {
    schema_version: 1,
    entry_id: 'e3',
    customer_id: 'c2',
    amount_poisha: 90_000,
    note: null,
    occurred_at: NOW,
  });

  const voided = await store.append('CREDIT_GIVEN', {
    schema_version: 1,
    entry_id: 'e4',
    customer_id: 'c1',
    amount_poisha: 1_000_000,
    note: null,
    occurred_at: NOW,
  });
  assert.ok(!('kind' in voided));
  await store.append('ENTRY_VOIDED', { schema_version: 1, voids_event_id: voided.id, reason: 'MISTAKE' });

  const vm = await getHomeVM(db, format);
  assert.equal(vm.isEmpty, false);
  // Only c1's 50,000 counts: c2 settled to zero, and c1's second credit was voided.
  assert.equal(vm.totalOwedDisplay, format.money(50_000 as Poisha));
  assert.equal(vm.recentActivity.length, 3); // e1, e2, e3 — e4 is voided, excluded
  assert.ok(vm.recentActivity.every((row) => row.id !== voided.id));
});

void test('REGRESSION: getHomeVM excludes an archived customer even with an outstanding balance', async () => {
  const { db, store } = await createTestStore();

  await store.append('CUSTOMER_ADDED', {
    schema_version: 1,
    customer_id: 'gone',
    display_name: 'আর্কাইভড',
    phone: null,
  });
  await store.append('CREDIT_GIVEN', {
    schema_version: 1,
    entry_id: 'e1',
    customer_id: 'gone',
    amount_poisha: 1_000_000,
    note: null,
    occurred_at: NOW,
  });
  // archiveCustomer.ts never checks the balance is zero before archiving —
  // this is the exact scenario that used to inflate Home's total forever.
  await store.append('CUSTOMER_ARCHIVED', { schema_version: 1, customer_id: 'gone', reason: 'REQUESTED' });

  const vm = await getHomeVM(db, format);
  assert.equal(vm.isEmpty, true);
  assert.equal(vm.totalOwedDisplay, format.money(0 as Poisha));
});

void test('REGRESSION: owedByCountDisplay counts non-zero balances, including negative — matching buildAgingVM', async () => {
  const { db, store } = await createTestStore();

  await store.append('CUSTOMER_ADDED', {
    schema_version: 1,
    customer_id: 'owes',
    display_name: 'রহিম',
    phone: null,
  });
  await store.append('CREDIT_GIVEN', {
    schema_version: 1,
    entry_id: 'e1',
    customer_id: 'owes',
    amount_poisha: 50_000,
    note: null,
    occurred_at: NOW,
  });

  // Same payment recorded twice offline — the NEGATIVE_BALANCE anomaly.
  await store.append('CUSTOMER_ADDED', {
    schema_version: 1,
    customer_id: 'overpaid',
    display_name: 'ফরিদা',
    phone: null,
  });
  await store.append('CREDIT_GIVEN', {
    schema_version: 1,
    entry_id: 'e2',
    customer_id: 'overpaid',
    amount_poisha: 30_000,
    note: null,
    occurred_at: NOW,
  });
  await store.append('PAYMENT_RECEIVED', {
    schema_version: 1,
    entry_id: 'e3',
    customer_id: 'overpaid',
    amount_poisha: 30_000,
    note: null,
    occurred_at: NOW,
  });
  await store.append('PAYMENT_RECEIVED', {
    schema_version: 1,
    entry_id: 'e4',
    customer_id: 'overpaid',
    amount_poisha: 30_000,
    note: null,
    occurred_at: NOW,
  });

  const vm = await getHomeVM(db, format);
  // The count includes BOTH customers (one positive, one negative balance) —
  // the total sums only the positive one.
  assert.equal(vm.owedByCountDisplay, format.count(2));
  assert.equal(vm.totalOwedDisplay, format.money(50_000 as Poisha));
});
