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
