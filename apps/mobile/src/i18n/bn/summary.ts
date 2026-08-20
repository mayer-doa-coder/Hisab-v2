// bn/summary.ts — CONTRIBUTING.md §4.2 namespace split. The daily summary
// screen (UI_SPEC.md: Phase 4, B's "daily summary").
//
// NATIVE-CHECK CANDIDATE. Counter Bangla, written by an agent, not agreed
// copy.
//
// UI_SPEC.md screen 1 says the home screen must have "No KPI grid, no charts,
// no period selector". The daily summary is a separate screen and is allowed
// to state today's numbers, but it inherits the spirit: numbers and their
// plain-language labels, no chart, no trend arrow, no comparison to a target
// nobody set. "Facts, not scores" applies to a shop's own performance the
// same way it applies to a customer.

export interface SummaryStrings {
  summaryTitle: string;
  today: string;
  creditGiven: string;
  paymentsReceived: string;
  netChange: string;
  netChangeUp: string;
  netChangeDown: string;
  netChangeFlat: string;
  entriesCount: string;
  goodsSold: string;
  nothingToday: string;
  nothingTodayHint: string;
  unsyncedNote: string;
}

export const summary: SummaryStrings = {
  summaryTitle: 'আজকের হিসাব',
  today: 'আজ',
  creditGiven: 'বাকি দেওয়া হয়েছে',
  paymentsReceived: 'জমা পড়েছে',
  netChange: 'সব মিলিয়ে',
  netChangeUp: 'বাকি বেড়েছে',
  netChangeDown: 'বাকি কমেছে',
  netChangeFlat: 'বাকি একই আছে',
  entriesCount: 'টি লেখা হয়েছে',
  goodsSold: 'মাল বিক্রি',
  nothingToday: 'আজ এখনো কিছু লেখা হয়নি',
  nothingTodayHint: 'বাকি বা জমা লিখলে এখানে দেখাবে',
  unsyncedNote: 'কিছু লেখা এখনো পাঠানো হয়নি',
};
