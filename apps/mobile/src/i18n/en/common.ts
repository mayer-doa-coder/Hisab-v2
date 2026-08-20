// en/common.ts — implements bn/common.ts's CommonStrings. Adding a key to
// one file without the other is a type error, not a missing-key fallback.

import type { CommonStrings } from '../bn/common';

export const common: CommonStrings = {
  appName: 'Hisab',
  galleryTitle: 'Design system gallery',
  numeralScriptLabel: 'Numeral script',
  numeralScriptBengali: 'Bengali',
  numeralScriptArabic: 'Arabic',
  languageLabel: 'Language',
  save: 'Save',
  cancel: 'Cancel',
  days: 'days',
  back: 'Back',
  delete: 'Delete',

  // PIN entry (Step 10). Added in the same commit as bn/common.ts —
  // AGENTS.md §6: "Both bn and en keys are added in the same commit."
  pinPrompt: 'Enter PIN',
  pinSetPrompt: 'Choose a PIN',
  pinConfirmPrompt: 'Enter the PIN again',
  pinMismatch: "The two PINs didn't match",
  pinIncorrect: 'Incorrect PIN',
  pinLocked: 'Try again in a moment',
};
