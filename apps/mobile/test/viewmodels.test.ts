// viewmodels.test.ts — toCustomerRowVM has no caller yet (Step 8 wires
// screens) and had no test at all before this audit, so a shape mismatch
// against CustomerRowVM's actual fields would have gone unnoticed until
// someone tried to render it. A fake ViewModelFormatter stands in for the
// real i18n-backed one (Step 8's job), matching how commands.test.ts etc.
// inject fakes for anything outside this file's own responsibility.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCustomerRowVM } from '../src/data/viewmodels.ts';
import type { ViewModelFormatter } from '@hisab/domain';

const fakeFormat: ViewModelFormatter = {
  money: (amount) => `TK${amount}`,
  days: (count) => `${count}d`,
  count: (value) => String(value),
  quantity: (count, unit) => `${count}${unit}`,
  unit: (unit) => unit,
  attention: (reason) => reason.kind,
};

void test('toCustomerRowVM maps a fully-populated row', () => {
  const vm = toCustomerRowVM(
    { id: 'c1', display_name: 'Rahim', phone: '017', balance_poisha: 5000, last_activity_at: 1_000 },
    1_000 + 3 * 86_400_000,
    fakeFormat,
    true,
  );

  assert.deepStrictEqual(vm, {
    id: 'c1',
    displayName: 'Rahim',
    phone: '017',
    balanceDisplay: 'TK5000',
    balancePoisha: 5000,
    daysSinceActivityDisplay: '3d',
    needsAttention: false,
    attentionReason: null,
    syncPending: true,
  });
});

void test('toCustomerRowVM defaults balance to 0 when no balance row exists', () => {
  const vm = toCustomerRowVM(
    { id: 'c1', display_name: 'Rahim', phone: null, balance_poisha: null, last_activity_at: null },
    1_000,
    fakeFormat,
    false,
  );
  assert.equal(vm.balancePoisha, 0);
  assert.equal(vm.balanceDisplay, 'TK0');
});

void test('REGRESSION: a customer who has never had any activity shows no day count, not "0 days"', () => {
  // Found during a whole-project audit: this used to fall back to
  // `daysSince ?? 0`, rendering "0 days" — read as "something happened
  // today" — for a customer with CUSTOMER_ADDED but no
  // CREDIT_GIVEN/PAYMENT_RECEIVED yet. Empty string is the same convention
  // AgingRowVM already uses for "never," which every screen already branches
  // on `!== ''` to hide.
  const vm = toCustomerRowVM(
    { id: 'c1', display_name: 'Rahim', phone: null, balance_poisha: null, last_activity_at: null },
    1_000,
    fakeFormat,
    false,
  );
  assert.equal(vm.daysSinceActivityDisplay, '');
});

// ---------------------------------------------------------------------------
// needsAttention / attentionReason. These were stubbed false/null from Step 7
// until Step 12; the test that used to live here asserted the stub. It now
// asserts the real rule, which lives in the domain
// (packages/domain/src/attention.ts) — this file only checks that the mapping
// through the formatter is wired correctly, not the rule itself, which has its
// own suite.
// ---------------------------------------------------------------------------

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

void test('needsAttention is REAL: an outstanding balance idle past the threshold flips it', () => {
  const vm = toCustomerRowVM(
    {
      id: 'c1',
      display_name: 'রহিম ভাই',
      phone: null,
      balance_poisha: 50_000,
      last_activity_at: NOW - 45 * DAY,
    },
    NOW,
    fakeFormat,
    false,
  );
  assert.equal(vm.needsAttention, true);
  // The domain picked the fact; the formatter wrote it. The real i18n
  // formatter renders this as "৪৫ দিন ধরে কিছু দেননি" — a fact, not a score
  // (AGENTS.md §4.8). The fake here just echoes the kind.
  assert.equal(vm.attentionReason, 'NO_ACTIVITY');
  assert.equal(vm.daysSinceActivityDisplay, '45d');
});

void test('needsAttention is REAL: a negative balance flips it immediately, at any age', () => {
  const vm = toCustomerRowVM(
    { id: 'c1', display_name: 'Rahim', phone: null, balance_poisha: -999_999, last_activity_at: NOW },
    NOW,
    fakeFormat,
    true,
  );
  assert.equal(vm.needsAttention, true);
  assert.equal(vm.attentionReason, 'BALANCE_NEGATIVE');
});

void test('a settled customer stays silent no matter how long ago they settled', () => {
  const vm = toCustomerRowVM(
    {
      id: 'c1',
      display_name: 'Rahim',
      phone: null,
      balance_poisha: 0,
      last_activity_at: NOW - 900 * DAY,
    },
    NOW,
    fakeFormat,
    false,
  );
  assert.equal(vm.needsAttention, false, 'nothing is owed, so there is nothing to say');
  assert.equal(vm.attentionReason, null);
});

void test('an outstanding balance inside the threshold stays silent', () => {
  const vm = toCustomerRowVM(
    {
      id: 'c1',
      display_name: 'Rahim',
      phone: null,
      balance_poisha: 50_000,
      last_activity_at: NOW - 3 * DAY,
    },
    NOW,
    fakeFormat,
    false,
  );
  assert.equal(vm.needsAttention, false);
  assert.equal(vm.attentionReason, null);
});
