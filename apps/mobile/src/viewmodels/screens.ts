// screens.ts — viewmodels for the Phase 4 screens: the aging view, the alerts
// screen, and the daily summary.
//
// SHARED: changing this file requires both team members to agree
// (AGENTS.md §2, CONTRIBUTING.md §2).
//
// Same contract as customer.ts and product.ts, and the same rule: every field
// is already a display string, or a boolean/enum/count that maps straight to a
// component prop. B never performs arithmetic on money and never decides who
// needs attention. This file has no imports, by design.
//
// ---------------------------------------------------------------------------
// WHY THE AGING VIEW NEEDS ITS OWN VIEWMODEL, RATHER THAN A LIST OF
// CustomerRowVM THAT THE SCREEN SORTS
//
// `CustomerRowVM.attentionReason` is a finished Bengali STRING and
// `daysSinceActivityDisplay` is "৪৫ দিন". Neither is sortable. A screen given
// only those would have to parse Bengali numerals back out of a display
// string to order the list — which is both absurd and exactly the kind of
// decision customer.ts's header reserves for the domain ("B never decides who
// is overdue").
//
// So the ORDER is computed where the raw numbers live, in the data layer, and
// arrives here already applied. The screen renders `attentionRows` top to
// bottom and never re-sorts.
// ---------------------------------------------------------------------------

/** One row of the aging view. A superset of nothing — deliberately its own shape. */
export interface AgingRowVM {
  /** ← CUSTOMER_ADDED.customer_id */
  id: string;
  /** ← CUSTOMER_ADDED.display_name, superseded by the latest CUSTOMER_RENAMED. */
  displayName: string;
  /** ← fold(CREDIT_GIVEN + PAYMENT_RECEIVED − ENTRY_VOIDED) → format.money() */
  balanceDisplay: string;
  /**
   * ← AttentionReason → format.attention(), e.g. "৪৫ দিন ধরে কিছু দেননি".
   *
   * FACTS, NOT SCORES (AGENTS.md §4.8, SECURITY.md §7). This is a statement
   * about what happened. There is deliberately NO severity field, NO risk
   * band, and NO colour hint anywhere in this interface — a customer standing
   * at the counter can read this screen, and v1's colour-coded
   * `CustomerRiskBadge` is the specific thing that must not come back.
   *
   * null on a row in the "everyone else" section.
   */
  attentionFact: string | null;
  /** ← BalanceState.last_activity_at vs now → format.days(). "এখনো কিছু হয়নি" if never. */
  daysSinceActivityDisplay: string;
  /** ← LedgerState.pendingCustomerIds (envelope `synced_at === null`) */
  syncPending: boolean;
}

/**
 * The whole aging screen in one object (requirement 7, within-shop).
 *
 * Shaped to answer "how much am I owed, by whom, and how long" WITHOUT
 * SCROLLING (docs/BUILD_PLAN.md Phase 4 exit criterion). A flat list of every
 * customer cannot meet that bar — a shop with sixty debtors scrolls no matter
 * how the rows are styled. So the screen is: one total, the handful of people
 * worth a look, and a counted summary of everyone else.
 */
export interface AgingVM {
  /** ← sum of every positive balance → format.money(). The largest element on screen. */
  totalOwedDisplay: string;
  /** ← count of customers with a non-zero balance, already in the user's numeral script. */
  owedByCountDisplay: string;
  /** True when nobody owes anything — the screen shows its empty state instead. */
  isEmpty: boolean;

  /**
   * Rows the domain flagged, ALREADY ORDERED. See the header note on why the
   * order is not the screen's to compute. Capped by the builder so the screen
   * fits without scrolling; `hiddenAttentionCount` is what did not fit.
   */
  attentionRows: readonly AgingRowVM[];
  /** ← already in the user's numeral script. "0" when nothing is flagged. */
  attentionCountDisplay: string;
  /** How many flagged rows were cut by the cap. 0 when all of them fit. */
  hiddenAttentionCount: number;
  /** ← hiddenAttentionCount, in the user's numeral script. */
  hiddenAttentionCountDisplay: string;

  /** Everyone with a balance who was NOT flagged. Ordered, rendered only on expand. */
  otherRows: readonly AgingRowVM[];
  /** ← otherRows.length, in the user's numeral script. */
  otherCountDisplay: string;

  /**
   * True when at least one flagged row is a negative balance, so the screen can
   * show the one-line "the same payment may have been recorded twice" note
   * once, under the list, instead of repeating it per row.
   */
  hasNegativeBalance: boolean;
}

// ---------------------------------------------------------------------------
// Alerts screen — low stock and expiry, both from packages/domain.
// ---------------------------------------------------------------------------

/** One stock alert. ← productAttention() → format.attention(). */
export interface StockAlertVM {
  /** ← PRODUCT_ADDED.product_id */
  id: string;
  /** ← ProductState.name */
  name: string;
  /** ← AttentionReason → format.attention(), e.g. "শেষ হয়ে গেছে". */
  fact: string;
  /** ← fold over movements → format.quantity(). Never a stored quantity field. */
  stockDisplay: string;
}

/**
 * One expiry alert. ← inventory.ts's expiryRisks().
 *
 * `atMostDisplay` is an UPPER BOUND, not a count, and the copy that renders it
 * says so. `STOCK_SOLD` carries no batch reference, so which batch is left on
 * the shelf is genuinely unknowable (EVENTS.md §4); claiming a precise number
 * would send the shopkeeper to bin saleable stock.
 */
export interface ExpiryAlertVM {
  id: string;
  name: string;
  /** ← min(on_hand, expired batch units) → format.quantity(). */
  atMostDisplay: string;
  /** ← ExpiryRisk.earliest_expired_date, as an ISO date. */
  expiredOn: string;
}

export interface AlertsVM {
  stockAlerts: readonly StockAlertVM[];
  expiryAlerts: readonly ExpiryAlertVM[];
  /** True when both lists are empty — the screen shows "সব ঠিক আছে". */
  isAllClear: boolean;
}

// ---------------------------------------------------------------------------
// Daily summary.
//
// UI_SPEC.md screen 1 bans a KPI grid, charts and a period selector on HOME.
// This is a separate screen and may state today's numbers, but it inherits the
// spirit: numbers with plain labels, no chart, no trend arrow, no comparison
// against a target nobody set. `netDirection` is an enum, not a colour.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Home (UI_SPEC screen 1) and Customer detail (screen 6) — added Step 14
// alongside the six core screens themselves.
// ---------------------------------------------------------------------------

/** One line of Home's recent-activity list. */
export interface RecentActivityRowVM {
  /** ← the CREDIT_GIVEN/PAYMENT_RECEIVED event id. */
  id: string;
  displayName: string;
  amountDisplay: string;
  /**
   * An ENUM, not a pre-rendered word — same reasoning as DailySummaryVM's
   * `netDirection` below: the screen picks the Bengali word via t(), this
   * file never does. Kept as a plain string union (not a @hisab/domain type)
   * because it is presentational only, matching customer.ts's own precedent
   * for fields that "map straight to a component prop."
   */
  kind: 'CREDIT' | 'PAYMENT';
}

/** UI_SPEC screen 1. Bans a KPI grid, charts and a period selector — one total, one button, recent activity. */
export interface HomeVM {
  /** ← sum of every positive balance → format.money(). */
  totalOwedDisplay: string;
  /** ← count of customers with a non-zero balance. */
  owedByCountDisplay: string;
  /** True when nobody owes anything. */
  isEmpty: boolean;
  recentActivity: readonly RecentActivityRowVM[];
}

/** One line of a customer's ledger (UI_SPEC screen 6: "Running balance, full history"). */
export interface CustomerHistoryRowVM {
  /** ← the CREDIT_GIVEN/PAYMENT_RECEIVED event id. */
  id: string;
  kind: 'CREDIT' | 'PAYMENT';
  amountDisplay: string;
  /** ← CustomerHistoryLine.balance_after_poisha → format.money(). */
  balanceAfterDisplay: string;
  /** ← days since this line → format.days(), the same convention AgingRowVM uses. */
  whenDisplay: string;
  /**
   * ← CustomerHistoryLine.voided. The line is kept and marked, not hidden —
   * a crossed-out paper ledger entry is still visible, and so is this one.
   */
  voided: boolean;
}

/** UI_SPEC screen 6. No risk score anywhere — see AgingRowVM's header for why. */
export interface CustomerDetailVM {
  id: string;
  displayName: string;
  phone: string | null;
  balanceDisplay: string;
  daysSinceActivityDisplay: string;
  syncPending: boolean;
  history: readonly CustomerHistoryRowVM[];
  isHistoryEmpty: boolean;
}

export interface DailySummaryVM {
  /** ← the day being summarised, already formatted. */
  dateDisplay: string;
  /** ← sum of today's CREDIT_GIVEN → format.money() */
  creditGivenDisplay: string;
  /** ← sum of today's PAYMENT_RECEIVED → format.money() */
  paymentsReceivedDisplay: string;
  /** ← |credit − payments| → format.money(). Never negative; direction is separate. */
  netChangeDisplay: string;
  /**
   * Which way the shop's outstanding credit moved today. An enum so the screen
   * picks a WORD, not a colour — "বাকি বেড়েছে" / "বাকি কমেছে". Red-for-bad on a
   * screen a customer may glance at is the badge rule again.
   */
  netDirection: 'UP' | 'DOWN' | 'FLAT';
  /** ← count of today's non-voided entries, in the user's numeral script. */
  entryCountDisplay: string;
  /** ← count of today's STOCK_SOLD line items, in the user's numeral script. */
  goodsSoldCountDisplay: string;
  /** True when nothing was recorded today — the screen shows its empty state. */
  isEmpty: boolean;
  /** ← any of today's events with `synced_at === null`. */
  hasUnsynced: boolean;
}
