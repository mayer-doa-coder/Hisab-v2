// formatter.test.ts — the REAL ViewModelFormatter (src/i18n/formatter.ts).
// Until Step 13 the only implementations of this interface were fakes inside
// test files, so nothing checked that the Bengali the shopkeeper actually sees
// is assembled correctly.
//
// The last test in this file is the important one: it scans the shipped
// dictionaries for risk vocabulary. That constraint is not a style preference
// — it is AGENTS.md §4.8, SECURITY.md §7 and UI_SPEC.md, and v1 shipped a
// colour-coded CustomerRiskBadge. A grep in CI is what stops it coming back.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFormatter } from '../src/i18n/formatter.ts';
import { t } from '../src/i18n/index.ts';
import type { Poisha } from '@hisab/domain';

const bnArabic = createFormatter('bn', 'arabic');
const bnBengali = createFormatter('bn', 'bengali');
const enArabic = createFormatter('en', 'arabic');

// ---------------------------------------------------------------------------
// money — Indian grouping, numeral script, and NO arithmetic in the UI
// ---------------------------------------------------------------------------

void test('money uses Indian grouping, not thousands grouping', () => {
  // AGENTS.md §6 / UI_SPEC.md: 12,34,567 — never 1,234,567.
  assert.equal(bnArabic.money(123_456_700 as Poisha), '12,34,567');
  assert.equal(bnArabic.money(100_000 as Poisha), '1,000');
  assert.equal(bnArabic.money(50_000 as Poisha), '500');
});

void test('money drops a .00 fraction but keeps a real one', () => {
  assert.equal(bnArabic.money(50_000 as Poisha), '500');
  assert.equal(bnArabic.money(50_050 as Poisha), '500.50');
});

void test('money renders Bengali numerals when the script setting says so', () => {
  // Numeral script is a SETTING (AGENTS.md §6), never hardcoded — the same
  // amount, two scripts.
  assert.equal(bnBengali.money(123_456_700 as Poisha), '১২,৩৪,৫৬৭');
  assert.equal(bnArabic.money(123_456_700 as Poisha), '12,34,567');
});

void test('money handles a negative balance without mangling the grouping', () => {
  // A negative balance is valid data (an over-payment, EVENTS.md §8), so this
  // path is reachable on the aging view, not theoretical.
  assert.equal(bnArabic.money(-123_456_700 as Poisha), '-12,34,567');
  assert.equal(bnBengali.money(-30_000 as Poisha), '-৩০০');
});

void test('money is exact at scale — no float drift on a large balance', () => {
  assert.equal(bnArabic.money(999_999_999 as Poisha), '99,99,999.99');
});

// ---------------------------------------------------------------------------
// days, count, quantity, unit
// ---------------------------------------------------------------------------

void test('days appends the unit word; count does not', () => {
  assert.equal(bnArabic.days(45), '45 দিন');
  assert.equal(bnBengali.days(45), '৪৫ দিন');
  // count() exists precisely so a bare number does not need the word stripped
  // back off with a regex. See ViewModelFormatter.count in types.ts.
  assert.equal(bnBengali.count(45), '৪৫');
  assert.equal(bnArabic.count(0), '0');
});

void test('quantity and unit render the unit word, never the raw enum', () => {
  assert.equal(bnArabic.quantity(5, 'KG'), '5 কেজি');
  assert.equal(bnBengali.quantity(5, 'KG'), '৫ কেজি');
  assert.equal(bnArabic.unit('DOZEN'), 'ডজন');
  assert.equal(enArabic.unit('DOZEN'), 'dozen');
  // Every ProductUnit resolves — a missing key would render as `undefined`.
  for (const unit of ['PIECE', 'KG', 'GRAM', 'LITRE', 'ML', 'PACKET', 'DOZEN'] as const) {
    assert.notEqual(bnArabic.unit(unit), undefined);
    assert.ok(bnArabic.unit(unit).length > 0, `${unit} has no Bengali label`);
  }
});

// ---------------------------------------------------------------------------
// attention — the strings a customer can read over the counter
// ---------------------------------------------------------------------------

void test('NO_ACTIVITY renders as the day-count fact UI_SPEC.md names by example', () => {
  // UI_SPEC.md: "Use ৪৫ দিন, never উচ্চ ঝুঁকি."
  const bengali = bnBengali.attention({ kind: 'NO_ACTIVITY', days: 45 });
  assert.equal(bengali, '৪৫ দিন ধরে কিছু দেননি');
  assert.ok(bengali.startsWith('৪৫ দিন'), 'the day count leads — it is the fact');
});

void test('every AttentionReason renders a non-empty string in both locales', () => {
  const reasons = [
    { kind: 'NO_ACTIVITY', days: 12 },
    { kind: 'BALANCE_NEGATIVE' },
    { kind: 'STOCK_LOW', remaining_units: 3 },
    { kind: 'STOCK_OUT' },
    { kind: 'STOCK_NEGATIVE' },
  ] as const;
  for (const reason of reasons) {
    for (const [name, formatter] of [['bn', bnArabic], ['en', enArabic]] as const) {
      const text = formatter.attention(reason);
      assert.ok(text.length > 0, `${reason.kind} is empty in ${name}`);
      assert.ok(!text.includes('undefined'), `${reason.kind} has a missing key in ${name}`);
    }
  }
});

void test('BALANCE_NEGATIVE states what happened, not who is at fault', () => {
  assert.equal(bnArabic.attention({ kind: 'BALANCE_NEGATIVE' }), 'বাকির চেয়ে বেশি জমা হয়েছে');
  assert.equal(enArabic.attention({ kind: 'BALANCE_NEGATIVE' }), 'More paid in than was owed');
});

// ===========================================================================
// THE CONSTRAINT TEST: no risk vocabulary anywhere in the shipped strings
// ===========================================================================

/**
 * Words that would turn a fact into a score. Bengali first, then the English
 * mirrors — a rendered "HIGH RISK" in the en locale is exactly as bad as
 * "উচ্চ ঝুঁকি" in bn, and the en dictionary is what a reviewer reads.
 *
 * SECURITY.md §7: "Risk framing is never visible to the customer. Facts, not
 * scores. [v1 had a colour-coded CustomerRiskBadge on the customer list row]".
 */
const BANNED = [
  'ঝুঁকি', // risk
  'খারাপ', // bad
  'বিপদ', // danger
  'সতর্কতা', // (risk-style) warning
  'risk',
  'risky',
  'defaulter',
  'default',
  'delinquent',
  'overdue',
  'bad debt',
  'score',
  'rating',
  'grade',
  'high risk',
  'low risk',
  'blacklist',
];

void test('no shipped string contains risk vocabulary (AGENTS.md §4.8, SECURITY.md §7)', async () => {
  const namespaces = ['common', 'customers', 'products', 'summary'] as const;
  const dictionaries = await Promise.all([
    import('../src/i18n/bn/common.ts'),
    import('../src/i18n/bn/customers.ts'),
    import('../src/i18n/bn/products.ts'),
    import('../src/i18n/bn/summary.ts'),
    import('../src/i18n/en/common.ts'),
    import('../src/i18n/en/customers.ts'),
    import('../src/i18n/en/products.ts'),
    import('../src/i18n/en/summary.ts'),
  ]);

  let scanned = 0;
  for (const module of dictionaries) {
    for (const dictionary of Object.values(module) as Record<string, string>[]) {
      for (const [key, value] of Object.entries(dictionary)) {
        if (typeof value !== 'string') continue;
        scanned++;
        const haystack = value.toLowerCase();
        for (const word of BANNED) {
          assert.ok(
            !haystack.includes(word),
            `"${key}" = "${value}" contains banned risk vocabulary "${word}". ` +
              'Facts, not scores — see AGENTS.md §4.8 and SECURITY.md §7.',
          );
        }
      }
    }
  }
  // Asserted rather than logged: eslint's no-console covers apps/mobile/**
  // (AGENTS.md §8 — no console.log reaches a release build), and the coverage
  // figure is more useful as a failing assertion than as a line of output that
  // nobody reads. `namespaces` is named here so the count is checked against
  // the real namespace list, not a magic number.
  assert.ok(
    scanned > 60,
    `expected to scan every string in ${namespaces.length} namespaces x 2 locales, only saw ${scanned}`,
  );
});

void test('every key resolves in both locales — no silent English fallback', () => {
  // t() indexes a Record<string,string>; a key present in bn but missing in en
  // would return undefined at runtime rather than throwing.
  const keys = {
    common: ['appName', 'save', 'cancel', 'days', 'back', 'delete'],
    customers: ['agingTitle', 'totalOwed', 'fromCustomers', 'needsLooking', 'seeEveryone', 'nothingOwed'],
    products: ['productsTitle', 'addProduct', 'alertsTitle', 'stockOut', 'expiryAtMost'],
    summary: ['summaryTitle', 'creditGiven', 'paymentsReceived', 'netChangeUp', 'nothingToday'],
  } as const;

  for (const [namespace, namespaceKeys] of Object.entries(keys)) {
    for (const key of namespaceKeys) {
      for (const locale of ['bn', 'en'] as const) {
        // @ts-expect-error — indexing the union of namespaces with a literal
        // key is exactly what t()'s generic prevents at a real call site; here
        // the point is to sweep them all in a loop.
        const value: string = t(locale, namespace, key);
        assert.equal(typeof value, 'string', `${locale}.${namespace}.${key} is not a string`);
        assert.ok(value.length > 0, `${locale}.${namespace}.${key} is empty`);
      }
    }
  }
});
