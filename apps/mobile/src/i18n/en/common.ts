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
};
