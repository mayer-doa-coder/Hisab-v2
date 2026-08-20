// attention.ts — the rules behind `needsAttention` / `attentionReason` on both
// viewmodels. Replaces the `false`/`null` stub that Step 7 left in
// apps/mobile/src/data/viewmodels.ts.
//
// CONTRIBUTING.md §2 and the header of apps/mobile/src/viewmodels/customer.ts:
// "B never performs arithmetic on money and never decides who is overdue."
// This file is where that decision lives. It returns an `AttentionReason`, a
// structured fact; B turns it into Bengali via `ViewModelFormatter.attention`.
//
// Zero I/O (AGENTS.md §3.1): `now` is a parameter, never read from a clock.
//
// ---------------------------------------------------------------------------
// WHY THERE IS NO "OVERDUE" RULE HERE, AND WHY THERE NEVER WILL BE
// ---------------------------------------------------------------------------
// Step 7's stub said the real rule needed "terms, activity patterns". Those
// inputs do not exist and are not coming:
//
//   CUSTOMER_ADDED  = { customer_id, display_name, phone }
//
// and that is the whole of it (EVENTS.md §3). There is no `credit_limit`, no
// `terms_days`, no `due_date`, and adding one is not a missing feature — it is
// a data-minimisation violation. SECURITY.md §6 names v1's customer form,
// which asked for "name, phone, address, credit limit, and due terms for
// someone standing at a counter", as the thing not to repeat, and CLAUDE.md
// lists "being helpful by adding extra fields" as a failure mode specific to
// this project.
//
// So "overdue" is not computable, because nothing was ever due on a date. The
// word itself was the bug. What IS computable from the committed projections
// is: money is outstanding, and nothing has happened for a while. That is a
// fact the shopkeeper can act on, and it is stated as a fact — a day count,
// never a band, a score, or a colour (AGENTS.md §4.8, SECURITY.md §7: the
// counter phone faces the customer).
//
// attention.test.ts asserts, at compile time and at run time, that
// `credit_limit` and `terms_days` are absent from the payload and from the
// projection, so a future "just add a due date" change fails the build rather
// than passing review.

import { isNegative } from './money';
import { stockLevel } from './inventory';
import type { AttentionReason, Poisha, ProductState, StockState } from './types';

const DAY_MS = 86_400_000;

/**
 * How long a positive balance may sit untouched before the customer list says
 * so.
 *
 * [VERIFY] UNTUNED PLACEHOLDER. Nothing in `research/` supports 30 rather than
 * 21 or 45 — it is a starting value, not a finding, and AGENTS.md §9 forbids
 * dressing it up as one. It is a named export precisely so it is greppable and
 * is one line to change against real pilot data. Same status, and the same
 * reason, as `DUPLICATE_SUSPECTED_WINDOW_MS` in anomalies.ts and the base
 * lockout interval in server/src/auth/lockout.ts.
 */
export const NO_ACTIVITY_ATTENTION_DAYS = 30;

/**
 * The two fields the rule is allowed to use. Structurally satisfied by
 * `BalanceState` (EVENTS.md §7's `balances` projection) and by the customer
 * projection row the mobile data layer reads, so neither has to be converted.
 */
export interface CustomerAttentionInput {
  readonly balance_poisha: Poisha;
  /**
   * `occurred_at ?? created_at` of the newest non-voided entry; null if there
   * has never been one. Device wall clock and therefore untrusted (EVENTS.md §1
   * invariant 2, DECISIONS.md 2026-08-08 on aging) — a phone whose clock is
   * years out will produce a nonsense day count here, which is a limitation we
   * accepted in writing rather than a bug in this function.
   */
  readonly last_activity_at: number | null;
}

/** Whole days elapsed. Negative if `last_activity_at` is in the future (clock skew). */
export function daysSince(lastActivityAt: number, now: number): number {
  return Math.floor((now - lastActivityAt) / DAY_MS);
}

/**
 * The customer-list attention rule. Priority order, and every branch is
 * reachable:
 *
 *   1. balance < 0  -> BALANCE_NEGATIVE, immediately, regardless of age.
 *   2. balance === 0 -> nothing, at ANY age.
 *   3. balance > 0 and idle for >= thresholdDays -> NO_ACTIVITY.
 *   4. otherwise    -> nothing.
 *
 * Rule 2 is the load-bearing one. A pure age test flags everyone who ever
 * bought once and then settled up, and a list that cries wolf gets ignored
 * inside a week. The rule is about money outstanding, not visit frequency: a
 * customer who cleared their baki in March is not a problem in August.
 *
 * Rule 1 does not age, because a negative balance is the NEGATIVE_BALANCE
 * anomaly (EVENTS.md §8) showing up on the row. It is a data question — most
 * often the same payment recorded on two offline devices — and it wants a
 * decision now, not in thirty days.
 *
 * `last_activity_at === null` needs no branch of its own: the balance only ever
 * moves on CREDIT_GIVEN / PAYMENT_RECEIVED, and both set it, so a null
 * timestamp implies a zero balance and is caught by rule 2. There is a test for
 * that implication rather than a comment asserting it.
 */
export function customerAttention(
  input: CustomerAttentionInput,
  now: number,
  thresholdDays: number = NO_ACTIVITY_ATTENTION_DAYS,
): AttentionReason | null {
  if (isNegative(input.balance_poisha)) {
    return { kind: 'BALANCE_NEGATIVE' };
  }
  if (input.balance_poisha === 0) {
    return null;
  }
  if (input.last_activity_at === null) {
    return null; // see the note above: unreachable with a positive balance
  }
  const days = daysSince(input.last_activity_at, now);
  if (days >= thresholdDays) {
    return { kind: 'NO_ACTIVITY', days };
  }
  return null;
}

/**
 * The product-list attention rule, over the same `AttentionReason` union.
 *
 * Archived products are silent: PRODUCT_ARCHIVED means the shopkeeper stopped
 * stocking it, and a permanent OUT alert on something deliberately discontinued
 * is noise. Bucketing is `stockLevel`'s, so the badge on the row and the reason
 * beside it can never disagree.
 */
export function productAttention(
  product: ProductState,
  stock: StockState | undefined,
): AttentionReason | null {
  if (product.archived) return null;

  const quantityUnits = stock?.quantity_units ?? 0;
  switch (stockLevel(quantityUnits, product.low_stock_threshold_units)) {
    case 'NEGATIVE':
      return { kind: 'STOCK_NEGATIVE' };
    case 'OUT':
      return { kind: 'STOCK_OUT' };
    case 'LOW':
      return { kind: 'STOCK_LOW', remaining_units: quantityUnits };
    case 'OK':
      return null;
  }
}
