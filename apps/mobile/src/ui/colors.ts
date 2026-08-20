// colors.ts — the ONE place colour values are declared, mirroring
// typography.ts's own rule for font names: no screen or component names a
// hex value itself.
//
// FIXED — found during a whole-project audit: no such file existed. Every
// screen (11 of them) and several ui/ primitives repeated the same raw hex
// literals independently — `#F6F8F7` alone appeared 9 times, `#14231C` and
// `#5B6B62` well over 30 each. That is not a stylistic nit: a future rebrand
// or a dark-mode pass would have to find and edit every one of those call
// sites by hand, with no way to tell "these two `#E4EAE7`s must always
// match" from "these two happen to be the same colour today." One named
// export per role closes that.
//
// Same values as before — this only gives them names, it does not repaint
// anything.

export const colors = {
  /** Primary text — near-black, used for names, amounts, headings. */
  textPrimary: '#14231C',
  /** Secondary/muted text — labels, captions, facts. */
  textMuted: '#5B6B62',
  /** Placeholder text inside a TextInput. */
  placeholder: '#9AA8A1',
  /** Plain white — screen backgrounds on high-focus screens, and text on a dark/accent surface. */
  white: '#FFFFFF',
  /** The light grey-green screen background most screens sit on. */
  screenBackground: '#F6F8F7',
  /** Brand green — primary buttons, selected states, links. */
  accent: '#1B6E4A',
  /** Error/failure text and destructive actions. */
  error: '#8A3B2A',
  /** Secondary button / unselected chip background. */
  surfaceSecondary: '#E9EEEC',
  /** TextInput border. */
  border: '#D8E1DD',
  /** Card border / a lighter divider variant. */
  borderLight: '#E4EAE7',
  /** Keypad key background. */
  keypadKey: '#F1F4F2',
  /** Card.tsx's hairline divider between rows. */
  divider: '#EDF1EF',
  /** The neutral per-row "unsynced" dot (UI_SPEC.md: never red — offline is normal, not an error). */
  syncDot: '#B4BFB9',
} as const;
