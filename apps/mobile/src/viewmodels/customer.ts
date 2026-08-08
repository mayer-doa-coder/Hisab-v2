// customer.ts — viewmodels for the customer screens.
//
// SHARED: changing this file requires both team members to agree
// (AGENTS.md §2, CONTRIBUTING.md §2).
//
// A produces these; B renders them. Every field is either already a display
// string or a boolean/enum that maps straight to a component prop. B never
// performs arithmetic on money and never decides who is overdue — those are
// domain concerns and they are already tested.
//
// This file has no imports, by design. A viewmodel that needs `Poisha` or
// `Date` in scope has leaked a domain concern into the UI layer.
//
// Every field below is annotated with what it is derived from. A field with no
// derivation is a bug in either this file or docs/EVENTS.md.

/** One row in the customer list (UI_SPEC screen 2) and in the picker (screen 4). */
export interface CustomerRowVM {
  /** ← CUSTOMER_ADDED.customer_id */
  id: string;
  /** ← CUSTOMER_ADDED.display_name, superseded by the latest CUSTOMER_RENAMED. */
  displayName: string;
  /**
   * ← CUSTOMER_ADDED.phone / CUSTOMER_RENAMED.phone.
   * Present so `src/search/` can match on it (UI_SPEC screen 2 searches Bangla,
   * Banglish and phone in one pass). Displaying it is B's choice, not required.
   */
  phone: string | null;
  /** ← fold(CREDIT_GIVEN + PAYMENT_RECEIVED − ENTRY_VOIDED) → format.money() */
  balanceDisplay: string;
  /**
   * ← the same fold, as an integer count of poisha, solely so the payment
   * keypad can prefill the full balance (UI_SPEC screen 5, "pre-filled with the
   * full balance, editable"). B may add and subtract integers here while an
   * amount is being composed; it is not ledgered money until an event is
   * emitted. See AGENTS.md §3.2 and DECISIONS.md 2026-08-08. B must never
   * divide it, format it, or render it directly — use balanceDisplay.
   */
  balancePoisha: number;
  /** ← BalanceState.last_activity_at vs ViewModelOptions.now → format.days() */
  daysSinceActivityDisplay: string;
  /** ← domain rule over the same inputs. Computed by domain, rendered by UI. */
  needsAttention: boolean;
  /**
   * ← AttentionReason → format.attention(), e.g. "৪৫ দিন ধরে কিছু দেননি".
   * Facts, not scores (AGENTS.md §4.8). The domain picks the fact; B writes the
   * Bengali.
   */
  attentionReason: string | null;
  /** ← LedgerState.pendingCustomerIds (envelope `synced_at === null`) */
  syncPending: boolean;
}
