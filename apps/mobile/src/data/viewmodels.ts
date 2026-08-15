// viewmodels.ts — maps projection rows into CustomerRowVM (Step 2's exact
// shape). needsAttention/attentionReason are stubbed false/null here —
// confirmed in this step's report: real overdue rules are Step 12's job and
// need data (terms, patterns) that doesn't exist yet. Building a partial
// version now would just be a second implementation Step 12 has to
// reconcile with.
//
// Money/day formatting goes through the already-defined ViewModelFormatter
// (packages/domain's viewmodel boundary, Step 2) — this file never formats a
// Poisha value itself, matching "B does no money arithmetic."

import type { Poisha, ViewModelFormatter } from '@hisab/domain';
import type { CustomerRowVM } from '../viewmodels/customer';

export interface CustomerProjectionRow {
  readonly id: string;
  readonly display_name: string;
  readonly phone: string | null;
  readonly balance_poisha: number | null;
  readonly last_activity_at: number | null;
}

export function toCustomerRowVM(
  row: CustomerProjectionRow,
  now: number,
  format: ViewModelFormatter,
  syncPending: boolean,
): CustomerRowVM {
  const balancePoisha = (row.balance_poisha ?? 0) as Poisha;
  const daysSince =
    row.last_activity_at === null ? null : Math.floor((now - row.last_activity_at) / 86_400_000);
  // KNOWN GAP, not a silent choice: when last_activity_at is null (a
  // customer with CUSTOMER_ADDED but no CREDIT_GIVEN/PAYMENT_RECEIVED yet),
  // `daysSince ?? 0` reads as "0 days since activity" — i.e. "something
  // happened today" — which is false; nothing has happened. ViewModelFormatter
  // (types.ts, Step 2, already committed) has no way to express "never" —
  // `days(count: number): string` takes no null/sentinel. Not fixed here:
  // either the formatter contract needs a new case, or this field needs a
  // separate boolean, and that's a shared-contract decision, not a
  // apps/mobile/src/data/ one to make alone.

  return {
    id: row.id,
    displayName: row.display_name,
    phone: row.phone,
    balanceDisplay: format.money(balancePoisha),
    balancePoisha: row.balance_poisha ?? 0,
    daysSinceActivityDisplay: format.days(daysSince ?? 0),
    // Stubbed — Step 12 builds the real overdue rule against real pilot
    // data (terms, activity patterns). Do not half-implement here.
    needsAttention: false,
    attentionReason: null,
    syncPending,
  };
}
