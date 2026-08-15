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

  // ---- PIN entry (Step 10) --------------------------------------------------
  // ADDED BY A, IN B'S DIRECTORY. This file is B's under .github/CODEOWNERS
  // and these six keys were written by A because the PIN screen needs them
  // and AGENTS.md §6 forbids hardcoding a user-facing string. Flagged in
  // Step 10's report for B's sign-off before merge — the Bengali below is a
  // NATIVE-CHECK CANDIDATE, not agreed copy.
  //
  // Facts, not scores (AGENTS.md §4.8): the failure string states what
  // happened, and there is no scolding, no attempt-shaming, and no red
  // severity language. Counter Bangla, not formal written Bangla.
  pinPrompt: string;
  pinSetPrompt: string;
  pinConfirmPrompt: string;
  pinMismatch: string;
  pinIncorrect: string;
  pinLocked: string;
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

  pinPrompt: 'পিন দিন',
  pinSetPrompt: 'নতুন পিন দিন',
  pinConfirmPrompt: 'পিনটি আবার দিন',
  pinMismatch: 'দুইবার একই পিন হয়নি',
  pinIncorrect: 'পিন মেলেনি',
  pinLocked: 'একটু পরে আবার চেষ্টা করুন',
};
