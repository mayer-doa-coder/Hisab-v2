// formatDigits.ts — pure digit-formatting helpers for Amount. No React, no
// domain imports, no side effects: given a plain number and a script choice,
// produce a display string. AGENTS.md §6: numeral script is a user SETTING,
// not a baked-in choice — see NumeralScript below and its use in Amount.tsx.

export type NumeralScript = 'bengali' | 'arabic';

const BENGALI_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

/**
 * Indian digit grouping: the last three digits form one group, everything
 * before that groups in pairs — 1234567 → "12,34,567", not "1,234,567"
 * (AGENTS.md §6).
 */
export function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const lastThree = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const pairedRest = rest.replace(/\B(?=(\d{2})+(?!\d)$)/g, ',');
  return `${pairedRest},${lastThree}`;
}

/**
 * Substitutes 0-9 for ০-৯ when the script is 'bengali'. Never called
 * without an explicit script argument — AGENTS.md §6: "Do not hardcode
 * Bengali numerals... it is a setting."
 */
export function toNumeralScript(text: string, script: NumeralScript): string {
  if (script === 'arabic') return text;
  return text.replace(/[0-9]/g, (digit) => BENGALI_DIGITS[Number(digit)] ?? digit);
}

/**
 * Formats a plain taka amount (not Poisha — this file has no domain
 * coupling) with Indian grouping and the requested numeral script.
 * ".00" is omitted for whole amounts — the amount is the largest, most
 * important element on screen (docs/UI_SPEC.md); a trailing ".00" on a
 * whole-taka credit is visual noise, not information.
 */
export function formatAmountDigits(valueTaka: number, script: NumeralScript): string {
  const isNegative = valueTaka < 0;
  const absolute = Math.abs(valueTaka);
  const [integerPart, fractionPart] = absolute.toFixed(2).split('.');
  const grouped = groupIndian(integerPart ?? '0');
  const hasFraction = fractionPart !== undefined && fractionPart !== '00';
  const combined = hasFraction ? `${grouped}.${fractionPart}` : grouped;
  const scripted = toNumeralScript(combined, script);
  return isNegative ? `-${scripted}` : scripted;
}

/**
 * Formats an integer POISHA value still being composed at the keypad
 * (UI_SPEC.md screens 4/5) — moved here from RecordEntryScreen.tsx so it is
 * a plain, testable string function like its siblings above, rather than
 * logic embedded in a `.tsx` screen this project's test suite cannot import
 * (RN components don't run under plain `node --test` — see
 * apps/mobile/test/tsconfig.json's own note on why `.tsx` stays out of the
 * test compile).
 *
 * Sign-handled via STRING slicing, matching `formatter.ts`'s `formatPoisha`
 * exactly: strip a leading `-` before slicing the last two digits into a
 * fraction, re-prepend it after. FIXED — found during a whole-project audit:
 * an earlier version sliced `String(poisha)` directly, so a negative
 * composing amount (e.g. a payment prefilled from a customer's negative
 * balance — the documented NEGATIVE_BALANCE anomaly) put the `-` in the
 * wrong place after `padStart(3, '0')` — `-5` rendered as `"0.-5"`, `-99` as
 * `"-.99"` — on the single largest element on screen.
 *
 * No `/100` anywhere: the last two digits of the poisha integer ARE the
 * fraction, read off by string position, never computed by division —
 * DECISIONS.md 2026-08-08's composing-amount carve-out.
 */
export function formatComposingPoisha(poisha: number, script: NumeralScript): string {
  const raw = String(poisha);
  const negative = raw.startsWith('-');
  const digits = (negative ? raw.slice(1) : raw).padStart(3, '0');
  const wholePart = digits.slice(0, -2);
  const fracPart = digits.slice(-2);
  const grouped = groupIndian(wholePart);
  const scripted = toNumeralScript(`${grouped}.${fracPart}`, script);
  return negative ? `-${scripted}` : scripted;
}
