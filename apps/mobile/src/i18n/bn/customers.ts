// bn/customers.ts — CONTRIBUTING.md §4.2 namespace split.
//
// NATIVE-CHECK CANDIDATE for everything added in Step 13 (the aging view).
// Counter Bangla, not formal written Bangla — বাকি, জমা, দোকান, মাল are the
// words shopkeepers use (CLAUDE.md).
//
// ---------------------------------------------------------------------------
// THE RULE THIS FILE EXISTS TO HOLD (AGENTS.md §4.8, SECURITY.md §7,
// UI_SPEC.md "Uncertainty and risk"):
//
//   Never render a risk score where a customer can see it. Use ৪৫ দিন,
//   never উচ্চ ঝুঁকি.
//
// The aging view is a screen a shopkeeper holds at a counter with the
// customer standing opposite. So every string below states a FACT about what
// did or did not happen — a day count, a number of people, an amount. There
// is no word here for "risky", "bad", "defaulter", "overdue", or "late", and
// none may be added. `needsLooking` is deliberately about the SHOPKEEPER'S
// attention ("worth a look"), not a judgement about the customer.
//
// v1 shipped a colour-coded CustomerRiskBadge on the customer list row. That
// is the thing this file, and AgingScreen.tsx's lack of any severity colour,
// exist to prevent.
// ---------------------------------------------------------------------------

export interface CustomersStrings {
  addCustomer: string;
  recordCredit: string;
  recordPayment: string;
  searchPlaceholder: string;
  newCustomer: string;

  // ---- Aging view (Step 13) ------------------------------------------------
  agingTitle: string;
  totalOwed: string;
  /** Follows a person count: "২৩ জন গ্রাহকের কাছে". */
  fromCustomers: string;
  needsLooking: string;
  everyoneElseFine: string;
  seeEveryone: string;
  seeFewer: string;
  nothingOwed: string;
  nothingOwedHint: string;

  // ---- Attention facts, rendered by ViewModelFormatter.attention ------------
  /** "৪৫ দিন ধরে কিছু দেননি" — the day count is prepended by the formatter. */
  noActivitySuffix: string;
  /** A payment recorded twice offline overshoots the balance. A data fact. */
  balanceNegative: string;
  /** Shown once, under the list, when any row is a negative balance. */
  balanceNegativeHint: string;

  neverAnyActivity: string;

  // ---- The six core screens (Step 14) --------------------------------------
  /** Screen 4/5's "Who?" prompt. */
  whoPrompt: string;
  /** Screen 4/5's "How much?" prompt. */
  howMuchPrompt: string;
  undo: string;
  /** Shown briefly after Undo is tapped. */
  undone: string;
  /** "Show this to the customer" — UI_SPEC.md: "not optional." */
  showCustomer: string;
  /** Label above the new balance on the Done screen. */
  newBalance: string;
  /** Label above the balance on Customer detail — one customer, not the aggregate `totalOwed`. */
  customerBalance: string;
  historyTitle: string;
  noHistoryYet: string;
  /** Shown on a history line an ENTRY_VOIDED targeted — kept, not hidden. */
  voidedLabel: string;
  recentActivityTitle: string;
  namePlaceholder: string;
  phoneOptionalPlaceholder: string;
  nameRequired: string;
  /** Noun form of বাকি, for a history/activity line ("রহিম — বাকি ৫০০৳"), distinct from the recordCredit verb. */
  creditLabel: string;
  /** Noun form of জমা, same reason. */
  paymentLabel: string;
  searchNoResults: string;
}

export const customers: CustomersStrings = {
  addCustomer: 'গ্রাহক যোগ করুন',
  recordCredit: 'বাকি লিখুন',
  recordPayment: 'জমা লিখুন',
  searchPlaceholder: 'নাম বা ফোন নম্বর খুঁজুন',
  newCustomer: '+ নতুন',

  agingTitle: 'কে কত বাকি',
  totalOwed: 'মোট বাকি',
  fromCustomers: 'জন গ্রাহকের কাছে',
  needsLooking: 'দেখা দরকার',
  everyoneElseFine: 'বাকিদের নিয়ে এখন কিছু বলার নেই',
  seeEveryone: 'সবাইকে দেখুন',
  seeFewer: 'কম দেখুন',
  nothingOwed: 'কারো কাছে বাকি নেই',
  nothingOwedHint: 'সবাই শোধ করে দিয়েছে',

  // Facts, not scores. "45 days since they gave anything" — what happened,
  // not what it means about them.
  noActivitySuffix: 'ধরে কিছু দেননি',
  balanceNegative: 'বাকির চেয়ে বেশি জমা হয়েছে',
  balanceNegativeHint: 'একই জমা দুইবার লেখা হয়ে থাকতে পারে',

  neverAnyActivity: 'এখনো কিছু হয়নি',

  whoPrompt: 'কার কাছে?',
  howMuchPrompt: 'কত টাকা?',
  undo: 'আনডু',
  undone: 'বাতিল করা হয়েছে',
  showCustomer: 'গ্রাহককে দেখান',
  newBalance: 'নতুন হিসাব',
  customerBalance: 'বাকি',
  historyTitle: 'বিবরণ',
  noHistoryYet: 'এখনো কোনো লেনদেন হয়নি',
  voidedLabel: 'বাতিল করা হয়েছে',
  recentActivityTitle: 'সাম্প্রতিক',
  namePlaceholder: 'নাম লিখুন',
  phoneOptionalPlaceholder: 'ফোন নম্বর (ঐচ্ছিক)',
  nameRequired: 'একটি নাম দিতে হবে',
  creditLabel: 'বাকি',
  paymentLabel: 'জমা',
  searchNoResults: 'কেউ পাওয়া যায়নি',
};
