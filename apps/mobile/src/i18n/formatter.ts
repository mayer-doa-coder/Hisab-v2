// formatter.ts — the REAL ViewModelFormatter. Until Step 13 the only
// implementations of this interface were fakes inside test files.
//
// packages/domain/src/types.ts on ViewModelFormatter: "Implemented by B in
// apps/mobile/src/i18n/, passed into the viewmodel builders. Every method
// returns a string already in the user's language and numeral script, with
// Indian digit grouping." This is that file.
//
// It is the seam CONTRIBUTING.md §2 describes: the domain decides WHAT to
// say (an AttentionReason, a Poisha, a day count) and this file decides how
// it reads in Bengali. The domain contains no user-facing string; this file
// contains no rule about who needs attention.
//
// ---------------------------------------------------------------------------
// NO ARITHMETIC ON MONEY HERE (AGENTS.md §3.2)
//
// `money()` takes a Poisha and must produce "12,34,567" — which needs a
// divide by 100 somewhere. That divide happens inside the domain, in
// money.ts's `toDisplayTaka`, which is exported for exactly this reason (see
// packages/domain/src/index.ts's header note). This file receives the string
// "1234567.00" and does string work on it: grouping, then numeral script.
// There is no `/ 100` anywhere below, and there must never be one.
// ---------------------------------------------------------------------------

import { toDisplayTaka } from '@hisab/domain';
import type { AttentionReason, Poisha, ProductUnit, ViewModelFormatter } from '@hisab/domain';
import { groupIndian, toNumeralScript, type NumeralScript } from '../ui/formatDigits';
import { t, type Locale } from './index';

/**
 * Splits the domain's "1234567.00" into a grouped, script-correct display
 * string. `.00` is dropped for whole amounts, matching formatDigits.ts's
 * existing rule: a trailing ".00" on a whole-taka balance is visual noise on
 * the largest element on screen (docs/UI_SPEC.md).
 */
function formatPoisha(amount: Poisha, script: NumeralScript): string {
  const raw = toDisplayTaka(amount); // the ONLY place poisha becomes taka
  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [integerPart = '0', fractionPart = '00'] = unsigned.split('.');
  const grouped = groupIndian(integerPart);
  const combined = fractionPart === '00' ? grouped : `${grouped}.${fractionPart}`;
  const scripted = toNumeralScript(combined, script);
  return negative ? `-${scripted}` : scripted;
}

/** Plain integers (day counts, quantities, people) still need the user's script. */
function formatCount(value: number, script: NumeralScript): string {
  return toNumeralScript(String(value), script);
}

const UNIT_KEYS = {
  PIECE: 'unitPiece',
  KG: 'unitKg',
  GRAM: 'unitGram',
  LITRE: 'unitLitre',
  ML: 'unitMl',
  PACKET: 'unitPacket',
  DOZEN: 'unitDozen',
} as const satisfies Record<ProductUnit, string>;

/**
 * Builds a formatter bound to one locale and one numeral script.
 *
 * Both are arguments rather than module state: numeral script is a user
 * SETTING (AGENTS.md §6) and locale is too, so a formatter that read either
 * from a global would be untestable and would silently pin every screen to
 * whatever was set first.
 */
export function createFormatter(locale: Locale, numeralScript: NumeralScript): ViewModelFormatter {
  return {
    money: (amount) => formatPoisha(amount, numeralScript),

    days: (value) => `${formatCount(value, numeralScript)} ${t(locale, 'common', 'days')}`,

    /** A bare number, no unit word. See ViewModelFormatter.count in types.ts. */
    count: (value) => formatCount(value, numeralScript),

    quantity: (count, unit) =>
      `${formatCount(count, numeralScript)} ${t(locale, 'products', UNIT_KEYS[unit])}`,

    unit: (unit) => t(locale, 'products', UNIT_KEYS[unit]),

    /**
     * FACTS, NOT SCORES (AGENTS.md §4.8, SECURITY.md §7). Every branch returns
     * a statement about what happened or what is on the shelf. None of them
     * grades anyone, and none of them may: this string is rendered on a phone
     * that a customer standing at the counter can read.
     *
     * NO_ACTIVITY is the one UI_SPEC.md names by example — "৪৫ দিন ধরে কিছু
     * দেননি", never "উচ্চ ঝুঁকি".
     */
    attention: (reason: AttentionReason) => {
      switch (reason.kind) {
        case 'NO_ACTIVITY':
          return `${formatCount(reason.days, numeralScript)} ${t(locale, 'common', 'days')} ${t(locale, 'customers', 'noActivitySuffix')}`;
        case 'BALANCE_NEGATIVE':
          return t(locale, 'customers', 'balanceNegative');
        case 'STOCK_LOW':
          return `${t(locale, 'products', 'stockLowRemaining')} ${formatCount(reason.remaining_units, numeralScript)}`;
        case 'STOCK_OUT':
          return t(locale, 'products', 'stockOut');
        case 'STOCK_NEGATIVE':
          return t(locale, 'products', 'stockNegative');
      }
    },
  };
}
