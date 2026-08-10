// typography.ts — the ONE place font family names and the size scale are
// declared. AGENTS.md §6 / docs/UI_SPEC.md: "Two font weights only: Regular
// and Bold... Size and colour carry the rest of the hierarchy." No
// component in ui/ names a font family string itself — they all read it
// from here, so there is exactly one place that could ever load a third
// weight by accident.

export const fontFamily = {
  regular: 'AnekBangla_400Regular',
  bold: 'AnekBangla_700Bold',
} as const;

export const fontSize = {
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
  // "The amount is the most important thing on screen... Largest element."
  amount: 40,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
} as const;

/** UI_SPEC.md physical constraints: "Minimum 48dp touch targets." */
export const minTouchTarget = 48;
