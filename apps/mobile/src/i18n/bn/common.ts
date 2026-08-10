// bn/common.ts — CONTRIBUTING.md §4.2: namespaced from day one, never one
// large locale file. `CommonStrings` is the canonical key set; en/common.ts
// implements the same interface, so a missing key is a type error at build
// time, not a silent runtime fallback to English.

export interface CommonStrings {
  appName: string;
  galleryTitle: string;
  numeralScriptLabel: string;
  numeralScriptBengali: string;
  numeralScriptArabic: string;
  languageLabel: string;
  save: string;
  cancel: string;
}

export const common: CommonStrings = {
  appName: 'হিসাব',
  galleryTitle: 'নকশা গ্যালারি',
  numeralScriptLabel: 'সংখ্যার লিপি',
  numeralScriptBengali: 'বাংলা',
  numeralScriptArabic: 'ইংরেজি',
  languageLabel: 'ভাষা',
  save: 'সংরক্ষণ',
  cancel: 'বাতিল',
};
