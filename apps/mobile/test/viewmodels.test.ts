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

void test('needsAttention and attentionReason are always stubbed false/null', () => {
  const vm = toCustomerRowVM(
    { id: 'c1', display_name: 'Rahim', phone: null, balance_poisha: -999999, last_activity_at: 1 },
    999_999_999,
    fakeFormat,
    true,
  );
  // Even a large negative balance and old activity must not flip these —
  // Step 12 builds the real rule; this file must never half-implement it.
  assert.equal(vm.needsAttention, false);
  assert.equal(vm.attentionReason, null);
});
