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

import { customerAttention, daysSince } from '@hisab/domain';
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

  // FIXED — found during a whole-project audit: this used to fall back to
  // `daysSince ?? 0`, which reads as "0 days since activity" (something
  // happened today) for a customer with CUSTOMER_ADDED but no
  // CREDIT_GIVEN/PAYMENT_RECEIVED yet — false; nothing has ever happened.
  // `screenViewmodels.ts`'s `buildAgingVM` (added later, for the same field's
  // sibling `AgingRowVM.daysSinceActivityDisplay`) already established the
  // correct convention: empty string for "never," and every screen that
  // renders this field already branches on `!== ''` to hide the subtitle
  // rather than show a lie. Matching that convention here, rather than
  // leaving the two viewmodels for the same underlying fact disagree with
  // each other depending which screen a customer is viewed from.
  const daysSinceActivityDisplay =
    row.last_activity_at === null ? '' : format.days(daysSince(row.last_activity_at, now));

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
    daysSinceActivityDisplay,
    needsAttention: reason !== null,
    attentionReason: reason === null ? null : format.attention(reason),
    syncPending,
  };
}
