export type Poisha = number & { readonly __brand: 'Poisha' };
export type Taka = number & { readonly __brand: 'Taka' };

export const fromTaka = (t: number): Poisha => Math.round(t * 100) as Poisha;

export const add = (a: Poisha, b: Poisha): Poisha => (a + b) as Poisha;

export const subtract = (a: Poisha, b: Poisha): Poisha => (a - b) as Poisha;

export const toDisplayTaka = (p: Poisha): string => (p / 100).toFixed(2);
