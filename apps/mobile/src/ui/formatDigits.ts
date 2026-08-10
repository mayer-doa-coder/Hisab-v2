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
