export type Poisha = number & { readonly __brand: 'Poisha' };
export type Taka = number & { readonly __brand: 'Taka' };

/**
 * Rounds to the nearest poisha via `Math.round`, which ties toward positive
 * infinity — e.g. 10.015 taka rounds up to 1002 poisha, but -10.015 taka
 * rounds up (toward zero) to -1001, not -1002. This asymmetry is native
 * `Math.round` behaviour, not a bug; see money.test.ts.
 */
export const fromTaka = (t: number): Poisha => Math.round(t * 100) as Poisha;

export const add = (a: Poisha, b: Poisha): Poisha => (a + b) as Poisha;

export const subtract = (a: Poisha, b: Poisha): Poisha => (a - b) as Poisha;

/** Negative balances are valid, expected data — anomaly detection reads this. */
export const isNegative = (p: Poisha): boolean => p < 0;

export const toDisplayTaka = (p: Poisha): string => (p / 100).toFixed(2);

/**
 * Totals a list of Poisha. Added Step 13 because the aging view and the daily
 * summary both need a sum, and the alternative was a `+=` loop in
 * apps/mobile/src/data/ — money arithmetic outside money.ts, which AGENTS.md
 * §3.2 forbids. The eslint poishaArithmeticGuard would NOT have caught that
 * loop (its selector matches identifiers ending in `_poisha`, and a local
 * accumulator is called `total`), so the rule would have been broken silently.
 * Aggregation is arithmetic; it belongs here.
 */
export const sumPoisha = (values: readonly Poisha[]): Poisha => {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total as Poisha;
};

/** |a - b|. Same reason as sumPoisha: the daily summary needs a magnitude. */
export const absDiff = (a: Poisha, b: Poisha): Poisha => Math.abs(a - b) as Poisha;
