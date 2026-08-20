// screenViewmodels.test.ts — the builders behind the four Phase 4 screens.
//
// These matter more than a typical viewmodel test because the screens are
// deliberately dumb: AgingScreen renders `attentionRows` top to bottom and
// never re-sorts, so if the ORDER is wrong here it is wrong on the counter.
// The ordering tests below are the real subject of this file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fold, type AnyEvent, type Poisha } from '@hisab/domain';
import {
  ATTENTION_ROW_CAP,
  buildAgingVM,
  buildAlertsVM,
  buildCustomerDetailVM,
  buildDailySummaryVM,
  buildProductListVM,
} from '../src/data/screenViewmodels.ts';
import { createFormatter } from '../src/i18n/formatter.ts';
import { toCustomerRowVM } from '../src/data/viewmodels.ts';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 7, 20);
const format = createFormatter('bn', 'arabic');

let seq = 0;
function env(atMs: number, synced = true) {
  seq += 1;
  return {
    id: `t-${seq}`,
    device_id: 'd1',
    seq,
    hlc: String(seq).padStart(8, '0'),
    shop_id: 's1',
    created_at: atMs,
    synced_at: synced ? atMs : null,
  };
}

function person(id: string, name: string): AnyEvent {
  return {
    ...env(NOW - 500 * DAY),
    type: 'CUSTOMER_ADDED',
    payload: { schema_version: 1, customer_id: id, display_name: name, phone: null },
  };
}

// Amounts are poisha, passed as plain integers and cast once here — never
// derived by multiplying a taka figure by 100 at the call site. That
// multiplication is money arithmetic (AGENTS.md §3.2: "arithmetic on money
// happens only inside packages/domain/src/money.ts"), and eslint's
// poishaArithmeticGuard does not catch it here because the guard keys on
// identifiers ending in `_poisha` and a local parameter named `taka` does
// not match — the same blind spot screenViewmodels.ts's sumPoisha/absDiff
// note already documents. Found during a whole-project audit; fixed by
// authoring the literals already multiplied, matching the convention
// packages/domain/test/generators.ts already uses.
function credit(id: string, poisha: number, daysAgo: number, synced = true): AnyEvent {
  const at = NOW - daysAgo * DAY;
  return {
    ...env(at, synced),
    type: 'CREDIT_GIVEN',
    payload: {
      schema_version: 1,
      entry_id: `e-${seq}`,
      customer_id: id,
      amount_poisha: poisha as Poisha,
      note: null,
      occurred_at: at,
    },
  };
}

function paid(id: string, poisha: number, daysAgo: number, synced = true): AnyEvent {
  const at = NOW - daysAgo * DAY;
  return {
    ...env(at, synced),
    type: 'PAYMENT_RECEIVED',
    payload: {
      schema_version: 1,
      entry_id: `e-${seq}`,
      customer_id: id,
      amount_poisha: poisha as Poisha,
      note: null,
      occurred_at: at,
    },
  };
}

function agingFrom(events: AnyEvent[], cap = ATTENTION_ROW_CAP) {
  const state = fold(events);
  return buildAgingVM(
    {
      customers: [...state.customers.values()],
      balances: state.balances,
      pendingCustomerIds: state.pendingCustomerIds,
    },
    NOW,
    format,
    cap,
  );
}

// ===========================================================================
// Aging view — "how much am I owed, by whom, and how long"
// ===========================================================================

void test('the total answers "how much am I owed" and counts only positive balances', () => {
  const vm = agingFrom([
    person('a', 'রহিম'),
    credit('a', 50000, 1),
    person('b', 'করিম'),
    credit('b', 30000, 1),
    // An over-payment is money over-recorded, not money owed. Including it
    // would quietly shrink the number the shopkeeper is trying to read.
    person('c', 'ফরিদা'),
    credit('c', 10000, 5),
    paid('c', 40000, 1),
  ]);
  assert.equal(vm.totalOwedDisplay, '800');
  assert.equal(vm.owedByCountDisplay, '3', 'all three still have a non-zero balance');
});

void test('a settled customer is absent entirely, however long ago they settled', () => {
  const vm = agingFrom([person('a', 'মোহাম্মদ আলী'), credit('a', 90000, 390), paid('a', 90000, 380)]);
  assert.equal(vm.isEmpty, true);
  assert.equal(vm.attentionRows.length, 0);
  assert.equal(vm.otherRows.length, 0);
});

void test('ORDER: a negative balance comes first, ahead of even the longest idle debt', () => {
  const vm = agingFrom([
    person('idle', 'চেয়ারম্যান'),
    credit('idle', 1200000, 200), // very old, very large
    person('neg', 'ফরিদা'),
    credit('neg', 30000, 6),
    paid('neg', 30000, 1),
    paid('neg', 30000, 1), // the same payment twice, offline
  ]);
  const first = vm.attentionRows[0];
  assert.ok(first !== undefined);
  assert.equal(first.displayName, 'ফরিদা', 'a data question outranks an aged debt');
  assert.equal(vm.hasNegativeBalance, true);
});

void test('ORDER: within the aged rows, longest idle first — that is the "how long"', () => {
  const vm = agingFrom([
    person('a', 'ক'),
    credit('a', 10000, 40),
    person('b', 'খ'),
    credit('b', 10000, 95),
    person('c', 'গ'),
    credit('c', 10000, 60),
  ]);
  assert.deepEqual(
    vm.attentionRows.map((r) => r.displayName),
    ['খ', 'গ', 'ক'],
    '95 days, then 60, then 40',
  );
});

void test('ORDER: equal idle time breaks by larger balance, then by name — total and stable', () => {
  const vm = agingFrom([
    person('a', 'খ'),
    credit('a', 10000, 50),
    person('b', 'ক'),
    credit('b', 10000, 50),
    person('c', 'গ'),
    credit('c', 90000, 50),
  ]);
  assert.deepEqual(
    vm.attentionRows.map((r) => r.displayName),
    ['গ', 'ক', 'খ'],
    'largest first; then the two equal ones by name, so renders do not reshuffle',
  );
});

void test('the flagged list is CAPPED so the screen fits without scrolling', () => {
  // Phase 4's exit criterion is "one screen without scrolling". A flat list of
  // every debtor cannot meet it; the cap plus a remainder count is the design.
  const events: AnyEvent[] = [];
  for (let i = 0; i < 9; i++) {
    events.push(person(`p${i}`, `person-${i}`), credit(`p${i}`, 10000, 40 + i));
  }
  const vm = agingFrom(events, 5);
  assert.equal(vm.attentionRows.length, 5);
  assert.equal(vm.attentionCountDisplay, '9');
  assert.equal(vm.hiddenAttentionCount, 4);
  assert.equal(vm.hiddenAttentionCountDisplay, '4');
});

void test('recently-active debtors land in otherRows with no attention fact', () => {
  const vm = agingFrom([
    person('a', 'নাসিমা'),
    credit('a', 22000, 1),
    person('b', 'সালমা'),
    credit('b', 78000, 120),
  ]);
  assert.deepEqual(vm.attentionRows.map((r) => r.displayName), ['সালমা']);
  assert.deepEqual(vm.otherRows.map((r) => r.displayName), ['নাসিমা']);
  assert.equal(vm.otherRows[0]?.attentionFact, null);
  assert.equal(vm.otherCountDisplay, '1');
});

void test('an archived customer is off the aging view even with a balance outstanding', () => {
  const events: AnyEvent[] = [
    person('a', 'রহিম'),
    credit('a', 50000, 60),
    {
      ...env(NOW - DAY),
      type: 'CUSTOMER_ARCHIVED',
      payload: { schema_version: 1, customer_id: 'a', reason: 'REQUESTED' },
    },
  ];
  assert.equal(agingFrom(events).isEmpty, true);
});

void test('the row carries the formatted fact, not a score — and no severity field exists', () => {
  const vm = agingFrom([person('a', 'রহিম ভাই'), credit('a', 50000, 45)]);
  const row = vm.attentionRows[0];
  assert.ok(row !== undefined);
  assert.equal(row.attentionFact, '45 দিন ধরে কিছু দেননি');
  assert.equal(row.balanceDisplay, '500');
  // AGENTS.md §4.8 / SECURITY.md §7: nothing on this row may grade anyone.
  for (const banned of ['severity', 'risk', 'riskLevel', 'score', 'color', 'colour', 'tone']) {
    assert.equal(banned in row, false, `AgingRowVM must not carry \`${banned}\``);
  }
});

void test('the per-row sync dot reflects unsynced writes (UI_SPEC.md)', () => {
  const vm = agingFrom([person('a', 'রহিম'), credit('a', 50000, 50, false)]);
  assert.equal(vm.attentionRows[0]?.syncPending, true);
});

// ===========================================================================
// Alerts
// ===========================================================================

function productAdded(id: string, name: string, threshold: number | null): AnyEvent {
  return {
    ...env(NOW - 100 * DAY),
    type: 'PRODUCT_ADDED',
    payload: {
      schema_version: 1,
      product_id: id,
      name,
      unit: 'KG',
      sale_price_poisha: 6000 as Poisha,
      low_stock_threshold_units: threshold,
    },
  };
}

function received(id: string, qty: number, expiry: string | null, daysAgo: number): AnyEvent {
  const at = NOW - daysAgo * DAY;
  return {
    ...env(at),
    type: 'STOCK_RECEIVED',
    payload: {
      schema_version: 1,
      movement_id: `m-${seq}`,
      product_id: id,
      quantity_units: qty,
      cost_price_poisha: 5000 as Poisha,
      expiry_date: expiry,
      occurred_at: at,
    },
  };
}

function sold(id: string, qty: number, daysAgo: number): AnyEvent {
  const at = NOW - daysAgo * DAY;
  return {
    ...env(at),
    type: 'STOCK_SOLD',
    payload: {
      schema_version: 1,
      movement_id: `m-${seq}`,
      product_id: id,
      quantity_units: qty,
      sale_price_poisha: 6000 as Poisha,
      sale_id: null,
      occurred_at: at,
    },
  };
}

void test('stock alerts come from the domain rule and are ordered negative, out, low', () => {
  const events = [
    productAdded('low', 'চাল', 10),
    received('low', 4, null, 5),
    productAdded('out', 'ডাল', 5),
    productAdded('neg', 'তেল', 5),
    received('neg', 1, null, 5),
    sold('neg', 3, 2),
    productAdded('fine', 'সাবান', 2),
    received('fine', 50, null, 5),
  ];
  const vm = buildAlertsVM(fold(events), events, NOW, format);
  assert.deepEqual(
    vm.stockAlerts.map((a) => a.name),
    ['তেল', 'ডাল', 'চাল'],
    'a count that does not add up first, then run out, then low',
  );
  assert.equal(vm.isAllClear, false);
  assert.ok(!vm.stockAlerts.some((a) => a.name === 'সাবান'), 'a healthy product raises nothing');
});

void test('the expiry alert is an UPPER BOUND capped by what is on hand', () => {
  // 10 units expired long ago, 10 fine, 17 sold: only 3 remain, so at most 3
  // of them can be from the old batch — true under any consumption order,
  // because STOCK_SOLD names no batch. No FEFO anywhere.
  const events = [
    productAdded('p', 'দুধ', null),
    received('p', 10, '2020-01-01', 60),
    received('p', 10, '2099-12-31', 50),
    sold('p', 17, 10),
  ];
  const vm = buildAlertsVM(fold(events), events, NOW, format);
  assert.equal(vm.expiryAlerts.length, 1);
  assert.equal(vm.expiryAlerts[0]?.atMostDisplay, '3 কেজি');
  assert.equal(vm.expiryAlerts[0]?.expiredOn, '2020-01-01');
});

void test('a sold-out product raises no expiry alert at all', () => {
  const events = [productAdded('p', 'দুধ', null), received('p', 10, '2020-01-01', 60), sold('p', 10, 5)];
  const vm = buildAlertsVM(fold(events), events, NOW, format);
  assert.equal(vm.expiryAlerts.length, 0);
});

void test('all clear when nothing is low, out, or past its date', () => {
  const events = [productAdded('p', 'সাবান', 2), received('p', 40, '2099-01-01', 5)];
  const vm = buildAlertsVM(fold(events), events, NOW, format);
  assert.equal(vm.isAllClear, true);
});

// ===========================================================================
// Product list
// ===========================================================================

void test('product rows show a folded stock quantity, never a stored one', () => {
  const events = [productAdded('p', 'চাল', 10), received('p', 25, null, 5), sold('p', 4, 1)];
  const rows = buildProductListVM(fold(events), format);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.stockDisplay, '21 কেজি');
  assert.equal(rows[0]?.stockLevel, 'OK');
  assert.equal(rows[0]?.priceDisplay, '60');
});

void test('archived products sort last', () => {
  const events: AnyEvent[] = [
    productAdded('a', 'অ', null),
    productAdded('z', 'য', null),
    { ...env(NOW), type: 'PRODUCT_ARCHIVED', payload: { schema_version: 1, product_id: 'a' } },
  ];
  const rows = buildProductListVM(fold(events), format);
  assert.deepEqual(rows.map((r) => r.name), ['য', 'অ']);
});

// ===========================================================================
// Daily summary
// ===========================================================================

function summaryFor(events: AnyEvent[]) {
  return buildDailySummaryVM(
    fold(events),
    events,
    { dayStart: NOW, dayEnd: NOW + DAY, dateDisplay: '2026-08-20' },
    format,
  );
}

void test('the summary counts only entries inside the day window', () => {
  const events = [
    person('a', 'রহিম'),
    credit('a', 50000, 0), // today
    credit('a', 30000, 3), // three days ago — outside
    paid('a', 20000, 0),
  ];
  const vm = summaryFor(events);
  assert.equal(vm.creditGivenDisplay, '500');
  assert.equal(vm.paymentsReceivedDisplay, '200');
  assert.equal(vm.entryCountDisplay, '2');
  assert.equal(vm.isEmpty, false);
});

void test('net direction is a WORD-selecting enum, never a colour, and the magnitude is unsigned', () => {
  const up = summaryFor([person('a', 'র'), credit('a', 50000, 0), paid('a', 20000, 0)]);
  assert.equal(up.netDirection, 'UP');
  assert.equal(up.netChangeDisplay, '300');

  const down = summaryFor([person('a', 'র'), credit('a', 20000, 0), paid('a', 50000, 0)]);
  assert.equal(down.netDirection, 'DOWN');
  assert.equal(down.netChangeDisplay, '300', 'a magnitude, not a negative number');

  const flat = summaryFor([person('a', 'র'), credit('a', 50000, 0), paid('a', 50000, 0)]);
  assert.equal(flat.netDirection, 'FLAT');
});

void test('a voided entry does not count toward the day', () => {
  const creditEvent = credit('a', 50000, 0);
  const events: AnyEvent[] = [
    person('a', 'রহিম'),
    creditEvent,
    {
      ...env(NOW),
      type: 'ENTRY_VOIDED',
      payload: { schema_version: 1, voids_event_id: creditEvent.id, reason: 'MISTAKE' },
    },
  ];
  const vm = summaryFor(events);
  assert.equal(vm.creditGivenDisplay, '0');
  assert.equal(vm.isEmpty, true);
});

void test('unsynced entries in the window are flagged once, not per row', () => {
  assert.equal(summaryFor([person('a', 'র'), credit('a', 50000, 0, false)]).hasUnsynced, true);
  assert.equal(summaryFor([person('a', 'র'), credit('a', 50000, 0, true)]).hasUnsynced, false);
});

// ---------------------------------------------------------------------------
// buildCustomerDetailVM — UI_SPEC screen 6.
// ---------------------------------------------------------------------------

void test('buildCustomerDetailVM: most-recent-first, with a correct per-line running balance', () => {
  const events: AnyEvent[] = [person('a', 'রহিম'), credit('a', 50000, 5), paid('a', 20000, 2)];
  const state = fold(events);
  const customerRow = toCustomerRowVM(
    {
      id: 'a',
      display_name: 'রহিম',
      phone: null,
      balance_poisha: state.balances.get('a')?.balance_poisha ?? 0,
      last_activity_at: state.balances.get('a')?.last_activity_at ?? null,
    },
    NOW,
    format,
    false,
  );

  const vm = buildCustomerDetailVM(customerRow, events, NOW, format);
  assert.equal(vm.isHistoryEmpty, false);
  assert.equal(vm.history.length, 2);
  // Most recent first: the payment (2 days ago) before the credit (5 days ago).
  assert.equal(vm.history[0]?.kind, 'PAYMENT');
  assert.equal(vm.history[0]?.balanceAfterDisplay, format.money(30000 as Poisha));
  assert.equal(vm.history[1]?.kind, 'CREDIT');
  assert.equal(vm.history[1]?.balanceAfterDisplay, format.money(50000 as Poisha));
  assert.equal(vm.history.every((row) => !row.voided), true);
});

void test('buildCustomerDetailVM: a voided line is kept and marked, and does not move the balance shown', () => {
  const creditEvent = credit('a', 50000, 5);
  const secondCredit = credit('a', 10000, 3);
  const events: AnyEvent[] = [
    person('a', 'রহিম'),
    creditEvent,
    secondCredit,
    {
      ...env(NOW),
      type: 'ENTRY_VOIDED',
      payload: { schema_version: 1, voids_event_id: secondCredit.id, reason: 'MISTAKE' },
    },
  ];
  const state = fold(events);
  const customerRow = toCustomerRowVM(
    {
      id: 'a',
      display_name: 'রহিম',
      phone: null,
      balance_poisha: state.balances.get('a')?.balance_poisha ?? 0,
      last_activity_at: state.balances.get('a')?.last_activity_at ?? null,
    },
    NOW,
    format,
    false,
  );

  const vm = buildCustomerDetailVM(customerRow, events, NOW, format);
  assert.equal(vm.history.length, 2);
  const voidedRow = vm.history.find((row) => row.id === secondCredit.id);
  assert.equal(voidedRow?.voided, true);
  assert.equal(voidedRow?.balanceAfterDisplay, format.money(50000 as Poisha));
});
