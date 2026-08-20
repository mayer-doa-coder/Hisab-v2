// attention.test.ts — the rule that replaces Step 7's needsAttention stub.
//
// The most important tests in this file are the two at the bottom. They assert
// that `credit_limit` and `terms_days` do not exist, at compile time and at run
// time, because the whole design rests on them not existing: the rule works
// with what the event log actually carries, or it does not ship.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NO_ACTIVITY_ATTENTION_DAYS,
  customerAttention,
  daysSince,
  productAttention,
} from '../src/attention.ts';
import { fold } from '../src/fold.ts';
import { generateSequence } from './generators.ts';
import type { AnyEvent, CustomerAddedPayload, Poisha, ProductState } from '../src/types.ts';

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

function ago(days: number): number {
  return NOW - days * DAY;
}

// ===========================================================================
// customerAttention — the four branches
// ===========================================================================

void test('a negative balance needs attention immediately, at any age', () => {
  for (const days of [0, 1, 5, 400]) {
    const reason = customerAttention(
      { balance_poisha: -500 as Poisha, last_activity_at: ago(days) },
      NOW,
    );
    assert.deepEqual(reason, { kind: 'BALANCE_NEGATIVE' }, `${days} days old`);
  }
});

void test('a settled customer is SILENT at any age — the load-bearing rule', () => {
  // This is what stops the list crying wolf. A pure age test would flag
  // everyone who ever bought once and then paid up, and a list that flags
  // everyone gets ignored inside a week.
  for (const days of [0, 30, 200, 3650]) {
    assert.equal(
      customerAttention({ balance_poisha: 0 as Poisha, last_activity_at: ago(days) }, NOW),
      null,
      `a zero balance ${days} days old must say nothing`,
    );
  }
});

void test('an outstanding balance idle past the threshold reports the day count', () => {
  const reason = customerAttention(
    { balance_poisha: 50_000 as Poisha, last_activity_at: ago(45) },
    NOW,
  );
  assert.deepEqual(reason, { kind: 'NO_ACTIVITY', days: 45 });
});

void test('an outstanding balance inside the threshold says nothing', () => {
  assert.equal(
    customerAttention({ balance_poisha: 50_000 as Poisha, last_activity_at: ago(3) }, NOW),
    null,
  );
});

void test('the threshold boundary is inclusive, and is overridable', () => {
  const at = { balance_poisha: 50_000 as Poisha, last_activity_at: ago(NO_ACTIVITY_ATTENTION_DAYS) };
  const before = {
    balance_poisha: 50_000 as Poisha,
    last_activity_at: ago(NO_ACTIVITY_ATTENTION_DAYS - 1),
  };
  assert.ok(customerAttention(at, NOW) !== null, 'exactly at the threshold counts');
  assert.equal(customerAttention(before, NOW), null, 'one day short does not');

  // The threshold is untuned (see attention.ts) so it is a parameter, not a
  // constant baked into the branch.
  assert.ok(customerAttention(before, NOW, 7) !== null, 'a shop-specific threshold is honoured');
});

void test('a null last_activity_at says nothing, and a positive balance can never have one', () => {
  assert.equal(
    customerAttention({ balance_poisha: 0 as Poisha, last_activity_at: null }, NOW),
    null,
  );

  // The implication that makes the null branch unreachable with money
  // outstanding: the balance only moves on CREDIT_GIVEN / PAYMENT_RECEIVED,
  // and both set last_activity_at. Asserted over random logs rather than
  // asserted in a comment.
  let checked = 0;
  for (let seed = 0; seed < 100; seed++) {
    for (const balance of fold(generateSequence(seed, 25)).balances.values()) {
      if (balance.balance_poisha !== 0) {
        assert.notEqual(
          balance.last_activity_at,
          null,
          `seed ${seed}: a non-zero balance with no last activity would break the rule`,
        );
        checked++;
      }
    }
  }
  console.log(`  positive-balance implies last_activity_at: ${checked} balances across 100 logs`);
});

void test('a future last_activity_at (clock skew) degrades to silence, never a crash', () => {
  const reason = customerAttention(
    { balance_poisha: 50_000 as Poisha, last_activity_at: NOW + 90 * DAY },
    NOW,
  );
  assert.equal(reason, null, 'negative day counts must not be reported as attention');
  assert.equal(daysSince(NOW + 90 * DAY, NOW), -90);
});

void test('customerAttention is total and never throws (property)', () => {
  const RUNS = 200;
  for (let seed = 0; seed < RUNS; seed++) {
    const balance = ((seed % 7) - 3) * 1000; // negative, zero and positive
    const last = seed % 5 === 0 ? null : ago(seed % 120);
    assert.doesNotThrow(() => {
      const reason = customerAttention({ balance_poisha: balance as Poisha, last_activity_at: last }, NOW);
      // Whatever comes back, it is one of the union's customer-side kinds —
      // never a stock kind, and never a severity or a score (AGENTS.md §4.8).
      if (reason !== null) {
        assert.ok(reason.kind === 'BALANCE_NEGATIVE' || reason.kind === 'NO_ACTIVITY');
        assert.equal('severity' in reason, false, 'facts, not scores: there is no severity field');
      }
    });
  }
  console.log(`  customerAttention totality: ${RUNS} inputs`);
});

// ===========================================================================
// productAttention
// ===========================================================================

function product(over: Partial<ProductState> = {}): ProductState {
  return {
    id: 'prod-1',
    name: 'চাল',
    unit: 'KG',
    sale_price_poisha: 6000 as Poisha,
    low_stock_threshold_units: 5,
    archived: false,
    ...over,
  };
}

void test('productAttention maps each stock bucket to its fact', () => {
  assert.deepEqual(
    productAttention(product(), { product_id: 'prod-1', quantity_units: -2 }),
    { kind: 'STOCK_NEGATIVE' },
  );
  assert.deepEqual(
    productAttention(product(), { product_id: 'prod-1', quantity_units: 0 }),
    { kind: 'STOCK_OUT' },
  );
  assert.deepEqual(
    productAttention(product(), { product_id: 'prod-1', quantity_units: 3 }),
    { kind: 'STOCK_LOW', remaining_units: 3 },
  );
  assert.equal(productAttention(product(), { product_id: 'prod-1', quantity_units: 50 }), null);
});

void test('a product with no threshold is never LOW, only OUT or NEGATIVE', () => {
  const p = product({ low_stock_threshold_units: null });
  assert.equal(productAttention(p, { product_id: 'prod-1', quantity_units: 1 }), null);
  assert.deepEqual(productAttention(p, { product_id: 'prod-1', quantity_units: 0 }), { kind: 'STOCK_OUT' });
});

void test('an archived product is silent — a permanent OUT alert on a discontinued item is noise', () => {
  assert.equal(
    productAttention(product({ archived: true }), { product_id: 'prod-1', quantity_units: 0 }),
    null,
  );
});

void test('a product with no stock row at all reads as OUT, not as missing', () => {
  assert.deepEqual(productAttention(product(), undefined), { kind: 'STOCK_OUT' });
});

// ===========================================================================
// THE FIELDS THAT DO NOT EXIST
//
// Step 7's stub deferred the "real overdue rule" pending "terms, activity
// patterns". Those inputs are not late — they are refused. A due date needs
// terms; terms need a field on the customer; and SECURITY.md §6 names v1's
// customer form ("name, phone, address, credit limit, and due terms for
// someone standing at a counter") as the specific thing not to repeat.
//
// So there is nothing to be overdue against, and the rule above is built on
// balance and last_activity_at because those are what the log actually
// carries. These two tests are what stop that from being quietly undone.
// ===========================================================================

/**
 * COMPILE-TIME GUARD. `AssertNoTermsFields` resolves to `true` only while none
 * of these keys exist on CustomerAddedPayload; the moment someone adds one, the
 * `= true` assignment below stops type-checking and `npm run typecheck` fails.
 *
 * Written this way rather than as a "this should fail to compile" test because
 * a test that must NOT compile cannot run in the same tsc pass as the suite
 * around it — it would have to be a separate compiler invocation with its own
 * expected-failure harness, which is a lot of machinery for a weaker signal.
 * This version fires on the commit that introduces the field, in CI, in the
 * same step that already runs.
 */
type CustomerKeys = keyof CustomerAddedPayload;
type AssertNoTermsFields = 'credit_limit' extends CustomerKeys
  ? never
  : 'credit_limit_poisha' extends CustomerKeys
    ? never
    : 'terms_days' extends CustomerKeys
      ? never
      : 'due_date' extends CustomerKeys
        ? never
        : 'payment_terms' extends CustomerKeys
          ? never
          : true;
const _noTermsFields: AssertNoTermsFields = true;

void test('CUSTOMER_ADDED carries exactly three fields, and none of them is a credit limit or a due term', () => {
  assert.equal(_noTermsFields, true, 'the compile-time guard above is what actually enforces this');

  const payload: CustomerAddedPayload = {
    schema_version: 1,
    customer_id: 'c1',
    display_name: 'রহিম ভাই',
    phone: null,
  };

  // Runtime half, so the guarantee also holds against a payload that arrived
  // over the wire rather than being constructed here.
  assert.deepEqual(Object.keys(payload).sort(), ['customer_id', 'display_name', 'phone', 'schema_version']);
  for (const forbidden of ['credit_limit', 'credit_limit_poisha', 'terms_days', 'due_date', 'payment_terms']) {
    assert.equal(
      forbidden in payload,
      false,
      `${forbidden} must not exist — SECURITY.md §6, data minimisation, and it is why there is no overdue rule`,
    );
  }
});

void test('the balances projection carries no due date either — the rule has two inputs and only two', () => {
  const events: AnyEvent[] = [
    {
      id: 'evt-1',
      device_id: 'device-a',
      seq: 1,
      hlc: '00000001',
      shop_id: 'shop-1',
      type: 'CUSTOMER_ADDED',
      payload: { schema_version: 1, customer_id: 'c1', display_name: 'রহিম ভাই', phone: null },
      created_at: NOW,
      synced_at: null,
    },
    {
      id: 'evt-2',
      device_id: 'device-a',
      seq: 2,
      hlc: '00000002',
      shop_id: 'shop-1',
      type: 'CREDIT_GIVEN',
      payload: {
        schema_version: 1,
        entry_id: 'e1',
        customer_id: 'c1',
        amount_poisha: 50_000 as Poisha,
        note: null,
        occurred_at: ago(45),
      },
      created_at: NOW,
      synced_at: null,
    },
  ];

  const balance = fold(events).balances.get('c1');
  assert.ok(balance !== undefined);
  assert.deepEqual(
    Object.keys(balance).sort(),
    ['balance_poisha', 'customer_id', 'last_activity_at'],
    'balance and last_activity_at are the whole of what the rule gets to work with',
  );

  // And end to end: this customer, through the real rule.
  assert.deepEqual(customerAttention(balance, NOW), { kind: 'NO_ACTIVITY', days: 45 });
});
