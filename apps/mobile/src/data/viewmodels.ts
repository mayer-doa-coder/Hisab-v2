// viewmodels.ts — maps projection rows into CustomerRowVM (Step 2's exact
// shape).
//
// needsAttention/attentionReason were stubbed false/null from Step 7 until
// Step 12. They are now real, and the rule they call is in the domain
// (packages/domain/src/attention.ts), not here — customer.ts's header is
// explicit that B "never decides who is overdue".
//
// The rule is NOT the "overdue" rule Step 7's TODO anticipated, because there
// is nothing to be overdue against: CUSTOMER_ADDED carries display_name and an
// optional phone and nothing else, and adding credit_limit or terms_days is a
// data-minimisation violation (SECURITY.md §6), not a missing feature. What
// ships instead is: outstanding balance + idle for a while = say so. See
// attention.ts for the full reasoning and the untuned threshold.
//
// Money/day formatting goes through the already-defined ViewModelFormatter
// (packages/domain's viewmodel boundary, Step 2) — this file never formats a
// Poisha value itself, matching "B does no money arithmetic."

import { customerAttention } from '@hisab/domain';
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

  // The domain picks the fact; format.attention() writes the Bengali
  // (AGENTS.md §4.8 — facts, not scores). A null reason is the normal case:
  // most customers, most days, need nothing said about them.
  const reason = customerAttention(
    { balance_poisha: balancePoisha, last_activity_at: row.last_activity_at },
    now,
  );

  return {
    id: row.id,
    displayName: row.display_name,
    phone: row.phone,
    balanceDisplay: format.money(balancePoisha),
    balancePoisha: row.balance_poisha ?? 0,
    daysSinceActivityDisplay: format.days(daysSince ?? 0),
    needsAttention: reason !== null,
    attentionReason: reason === null ? null : format.attention(reason),
    syncPending,
  };
}
