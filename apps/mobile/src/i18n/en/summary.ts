// en/summary.ts — implements bn/summary.ts's SummaryStrings. Adding a key to
// one file without the other is a type error (AGENTS.md §6).

import type { SummaryStrings } from '../bn/summary';

export const summary: SummaryStrings = {
  summaryTitle: "Today's tally",
  today: 'Today',
  creditGiven: 'Credit given',
  paymentsReceived: 'Payments received',
  netChange: 'All together',
  netChangeUp: 'Credit went up',
  netChangeDown: 'Credit came down',
  netChangeFlat: 'Credit unchanged',
  entriesCount: 'entries recorded',
  goodsSold: 'Goods sold',
  nothingToday: 'Nothing recorded today yet',
  nothingTodayHint: 'Credit and payments will show up here',
  unsyncedNote: 'Some entries have not been sent yet',
};
