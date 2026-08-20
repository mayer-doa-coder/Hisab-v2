// en/customers.ts — implements bn/customers.ts's CustomersStrings. Adding a
// key to one file without the other is a type error (AGENTS.md §6).

import type { CustomersStrings } from '../bn/customers';

export const customers: CustomersStrings = {
  addCustomer: 'Add customer',
  recordCredit: 'Record credit',
  recordPayment: 'Record payment',
  searchPlaceholder: 'Search name or phone',
  newCustomer: '+ New',

  agingTitle: 'Who owes what',
  totalOwed: 'Total owed to me',
  fromCustomers: 'customers',
  needsLooking: 'Worth a look',
  everyoneElseFine: 'Nothing to say about the rest right now',
  seeEveryone: 'See everyone',
  seeFewer: 'See fewer',
  nothingOwed: 'Nobody owes anything',
  nothingOwedHint: 'Everyone has settled up',

  // Facts, not scores — a day count, never a label.
  noActivitySuffix: 'since anything came in',
  balanceNegative: 'More paid in than was owed',
  balanceNegativeHint: 'The same payment may have been recorded twice',

  neverAnyActivity: 'Nothing yet',

  whoPrompt: 'Who?',
  howMuchPrompt: 'How much?',
  undo: 'Undo',
  undone: 'Undone',
  showCustomer: 'Show the customer',
  newBalance: 'New balance',
  customerBalance: 'Balance',
  historyTitle: 'History',
  noHistoryYet: 'No transactions yet',
  voidedLabel: 'Voided',
  recentActivityTitle: 'Recent',
  namePlaceholder: 'Enter a name',
  phoneOptionalPlaceholder: 'Phone number (optional)',
  nameRequired: 'A name is required',
  creditLabel: 'Credit',
  paymentLabel: 'Payment',
  searchNoResults: 'Nobody found',
};
