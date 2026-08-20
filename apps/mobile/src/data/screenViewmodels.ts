// screenViewmodels.ts — builders for the Phase 4 screens' viewmodels.
//
// OWNERSHIP: this is apps/mobile/src/data/, which .github/CODEOWNERS assigns
// to A. It is written here in Step 13 (B's screens) because the alternative
// was worse: the ordering and the money arithmetic these screens need CANNOT
// live in the screen without breaking the rule that B does neither. Flagged in
// this step's report, not slipped in — see the note there about the PR split.
//
// Every rule these builders apply comes from packages/domain: `customerAttention`
// and `productAttention` decide who needs attention, `stockLevel` buckets
// stock, `expiryRisks` bounds expiry. Nothing is re-decided here. What this
// file does is aggregate, order, cap, and hand everything to the
// ViewModelFormatter — the three things a pure function of one row cannot do.
//
// ZERO money arithmetic in this file (AGENTS.md §3.2). Totals go through
// `sumPoisha` and `absDiff`, which live in packages/domain/src/money.ts and
// were exported in Step 13 for exactly this. The first draft summed with a
// local `+=` loop; eslint's poishaArithmeticGuard did NOT flag it, because its
// selector keys on identifiers ending in `_poisha` and an accumulator is not
// called that — so the rule would have been broken silently. Exporting the
// operation was the fix, not relying on the linter's blind spot.

import {
  absDiff,
  customerAttention,
  customerHistory,
  daysSince,
  expiryRisks,
  productAttention,
  stockLevel,
  sumPoisha,
  type AnyEvent,
  type AttentionReason,
  type BalanceState,
  type CustomerState,
  type LedgerState,
  type Poisha,
  type ProductState,
  type StockState,
  type ViewModelFormatter,
} from '@hisab/domain';
import type { CustomerRowVM } from '../viewmodels/customer';
import type { ProductRowVM } from '../viewmodels/product';
import type {
  AgingRowVM,
  AgingVM,
  AlertsVM,
  CustomerDetailVM,
  CustomerHistoryRowVM,
  DailySummaryVM,
  ExpiryAlertVM,
  StockAlertVM,
} from '../viewmodels/screens';

/**
 * How many flagged rows the aging view shows before collapsing the rest into a
 * count.
 *
 * [VERIFY] UNTUNED. Chosen to keep the screen inside one 640dp viewport
 * alongside the total header, which is the Phase 4 exit criterion ("one screen
 * without scrolling"); it is not a finding about how many customers a
 * shopkeeper can hold in mind. Same status as
 * `NO_ACTIVITY_ATTENTION_DAYS` — named so it is greppable and one line to
 * change once a real shop has used it.
 */
export const ATTENTION_ROW_CAP = 5;

// ---------------------------------------------------------------------------
// Aging view
// ---------------------------------------------------------------------------

/**
 * The attention ordering. THIS is why the screen cannot sort for itself: it
 * runs on the raw numbers, before anything becomes a Bengali string.
 *
 *   1. BALANCE_NEGATIVE first — it is the NEGATIVE_BALANCE anomaly surfacing
 *      (EVENTS.md §8), a data question that wants a decision today, and it does
 *      not age.
 *   2. then longest idle first — the actual "how long" the screen exists to answer.
 *   3. then largest balance, then name, purely so the order is total and the
 *      list does not reshuffle between renders.
 *
 * Note what is NOT here: any weighting of amount against age into a single
 * number. That would be a risk score with the label filed off, and it is
 * banned (AGENTS.md §4.8, SECURITY.md §7).
 */
function compareAttention(
  a: { reason: AttentionReason | null; idleDays: number; balance: Poisha; name: string },
  b: { reason: AttentionReason | null; idleDays: number; balance: Poisha; name: string },
): number {
  const rank = (r: AttentionReason | null) => (r?.kind === 'BALANCE_NEGATIVE' ? 0 : 1);
  if (rank(a.reason) !== rank(b.reason)) return rank(a.reason) - rank(b.reason);
  if (a.idleDays !== b.idleDays) return b.idleDays - a.idleDays;
  // A COMPARISON, not a subtraction: `b.balance - a.balance` is arithmetic on
  // Poisha outside packages/domain/src/money.ts (AGENTS.md §3.2), and eslint's
  // poishaArithmeticGuard does not catch it here because its selector keys on
  // identifiers ending in `_poisha` and a destructured field named `balance`
  // does not match — the same blind spot the sumPoisha/absDiff note above
  // documents. `money.ts`'s own `isNegative` already establishes that a raw
  // `<`/`>` comparison on a Poisha value is fine outside money.ts; only the
  // arithmetic operators are reserved. Found during a whole-project audit.
  if (a.balance !== b.balance) return a.balance > b.balance ? -1 : 1;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

export interface AgingInput {
  readonly customers: readonly CustomerState[];
  readonly balances: ReadonlyMap<string, BalanceState>;
  readonly pendingCustomerIds: ReadonlySet<string>;
}

export function buildAgingVM(
  input: AgingInput,
  now: number,
  format: ViewModelFormatter,
  attentionRowCap: number = ATTENTION_ROW_CAP,
): AgingVM {
  interface Candidate {
    reason: AttentionReason | null;
    idleDays: number;
    balance: Poisha;
    name: string;
    row: AgingRowVM;
  }

  const withBalance: Candidate[] = [];

  for (const customer of input.customers) {
    if (customer.archived) continue; // archived customers are off every list

    const balanceState = input.balances.get(customer.id);
    const balance = (balanceState?.balance_poisha ?? 0) as Poisha;
    if (balance === 0) continue; // settled: not owed, so not on an "who owes what" screen

    const lastActivityAt = balanceState?.last_activity_at ?? null;
    const reason = customerAttention({ balance_poisha: balance, last_activity_at: lastActivityAt }, now);
    const idleDays = lastActivityAt === null ? 0 : daysSince(lastActivityAt, now);

    withBalance.push({
      reason,
      idleDays,
      balance,
      name: customer.display_name,
      row: {
        id: customer.id,
        displayName: customer.display_name,
        balanceDisplay: format.money(balance),
        attentionFact: reason === null ? null : format.attention(reason),
        daysSinceActivityDisplay:
          lastActivityAt === null ? '' : format.days(idleDays),
        syncPending: input.pendingCustomerIds.has(customer.id),
      },
    });
  }

  withBalance.sort(compareAttention);

  const flagged = withBalance.filter((c) => c.reason !== null);
  const others = withBalance.filter((c) => c.reason === null);

  const shown = flagged.slice(0, attentionRowCap);
  const hidden = flagged.length - shown.length;

  // Only positive balances count toward "owed to me". A negative one is money
  // over-recorded, not money owed, and adding it would quietly reduce the total
  // the shopkeeper is trying to read.
  const owedTotal = sumPoisha(withBalance.filter((c) => c.balance > 0).map((c) => c.balance));

  return {
    totalOwedDisplay: format.money(owedTotal),
    owedByCountDisplay: format.count(withBalance.length),
    isEmpty: withBalance.length === 0,

    attentionRows: shown.map((c) => c.row),
    attentionCountDisplay: format.count(flagged.length),
    hiddenAttentionCount: hidden,
    hiddenAttentionCountDisplay: format.count(hidden),

    otherRows: others.map((c) => c.row),
    otherCountDisplay: format.count(others.length),

    hasNegativeBalance: flagged.some((c) => c.reason?.kind === 'BALANCE_NEGATIVE'),
  };
}

// ---------------------------------------------------------------------------
// Product list
// ---------------------------------------------------------------------------

/**
 * One product row. `stockLevel` and `needsAttention` both come from the
 * domain — `stockDisplay` is a fold over movements, never a stored quantity
 * (that was the v1 bug, and ProductState has no quantity field to read).
 */
export function toProductRowVM(
  product: ProductState,
  stock: StockState | undefined,
  syncPending: boolean,
  format: ViewModelFormatter,
): ProductRowVM {
  const quantityUnits = stock?.quantity_units ?? 0;
  const reason = productAttention(product, stock);
  return {
    id: product.id,
    name: product.name,
    unitLabel: format.unit(product.unit),
    priceDisplay: product.sale_price_poisha === null ? null : format.money(product.sale_price_poisha),
    stockDisplay: format.quantity(quantityUnits, product.unit),
    stockLevel: stockLevel(quantityUnits, product.low_stock_threshold_units),
    needsAttention: reason !== null,
    attentionReason: reason === null ? null : format.attention(reason),
    syncPending,
  };
}

/** Archived products last, then by name. Nothing here re-decides stock status. */
export function buildProductListVM(
  state: LedgerState,
  format: ViewModelFormatter,
): ProductRowVM[] {
  const rows: { archived: boolean; name: string; row: ProductRowVM }[] = [];
  for (const product of state.products.values()) {
    rows.push({
      archived: product.archived,
      name: product.name,
      row: toProductRowVM(
        product,
        state.stock.get(product.id),
        state.pendingProductIds.has(product.id),
        format,
      ),
    });
  }
  rows.sort((a, b) => {
    if (a.archived !== b.archived) return a.archived ? 1 : -1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  return rows.map((r) => r.row);
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export function buildAlertsVM(
  state: LedgerState,
  events: readonly AnyEvent[],
  now: number,
  format: ViewModelFormatter,
): AlertsVM {
  // Negative stock first (a count that does not add up needs resolving), then
  // out, then low. Within a bucket, by name, so the order is total.
  //
  // `bucket` is computed ONCE per product here, alongside the row itself —
  // mirroring buildAgingVM's own Candidate pattern just above in this file.
  // FIXED — found during a whole-project audit: this used to call
  // productAttention() a second time per product inside the sort
  // comparator (bucketOf), recomputing the exact same classification
  // Array.sort had already paid for once per row here — O(n log n) wasted
  // domain calls for a value already sitting on the row.
  const severityOrder = { STOCK_NEGATIVE: 0, STOCK_OUT: 1, STOCK_LOW: 2 } as const;
  const candidates: { bucket: number; name: string; row: StockAlertVM }[] = [];

  for (const product of state.products.values()) {
    const stock = state.stock.get(product.id);
    const reason = productAttention(product, stock); // the domain decides, not this file
    if (reason === null) continue;
    const bucket = reason.kind in severityOrder ? severityOrder[reason.kind as keyof typeof severityOrder] : 3;
    candidates.push({
      bucket,
      name: product.name,
      row: {
        id: product.id,
        name: product.name,
        fact: format.attention(reason),
        stockDisplay: format.quantity(stock?.quantity_units ?? 0, product.unit),
      },
    });
  }

  candidates.sort((a, b) => {
    const d = a.bucket - b.bucket;
    return d !== 0 ? d : a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  const stockAlerts: StockAlertVM[] = candidates.map((c) => c.row);

  const expiryAlerts: ExpiryAlertVM[] = expiryRisks(state, events, now).map((risk) => {
    const product = state.products.get(risk.product_id);
    return {
      id: risk.product_id,
      name: product?.name ?? risk.product_id,
      // An UPPER BOUND. The screen's copy says "at most" — see ExpiryAlertVM.
      atMostDisplay: format.quantity(risk.at_most_expired_units, product?.unit ?? 'PIECE'),
      expiredOn: risk.earliest_expired_date,
    };
  });

  return {
    stockAlerts,
    expiryAlerts,
    isAllClear: stockAlerts.length === 0 && expiryAlerts.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Daily summary
// ---------------------------------------------------------------------------

/**
 * `dayStart` and `dayEnd` are passed in rather than derived from `now`,
 * because bucketing a timestamp into a day needs a timezone and this app is
 * UTC+6 — the same reason `daily_sales` is still unbuilt in the domain
 * (DECISIONS.md 2026-08-20). Making the window an explicit argument keeps that
 * decision at the call site, where it is visible, instead of hiding a
 * hard-coded offset in here.
 */
export function buildDailySummaryVM(
  state: LedgerState,
  events: readonly AnyEvent[],
  window: { readonly dayStart: number; readonly dayEnd: number; readonly dateDisplay: string },
  format: ViewModelFormatter,
): DailySummaryVM {
  const inWindow = events.filter((event) => {
    if (state.voided.has(event.id)) return false; // a voided entry did not happen
    const at =
      event.type === 'CREDIT_GIVEN' ||
      event.type === 'PAYMENT_RECEIVED' ||
      event.type === 'STOCK_SOLD'
        ? (event.payload.occurred_at ?? event.created_at)
        : event.created_at;
    return at >= window.dayStart && at < window.dayEnd;
  });

  const credits = inWindow.filter((e) => e.type === 'CREDIT_GIVEN');
  const payments = inWindow.filter((e) => e.type === 'PAYMENT_RECEIVED');
  const goodsSold = inWindow.filter((e) => e.type === 'STOCK_SOLD');

  const creditTotal = sumPoisha(
    credits.map((e) => (e.type === 'CREDIT_GIVEN' ? e.payload.amount_poisha : (0 as Poisha))),
  );
  const paymentTotal = sumPoisha(
    payments.map((e) => (e.type === 'PAYMENT_RECEIVED' ? e.payload.amount_poisha : (0 as Poisha))),
  );

  // Direction from a COMPARISON (not arithmetic), magnitude from the domain.
  const netDirection: DailySummaryVM['netDirection'] =
    creditTotal > paymentTotal ? 'UP' : creditTotal < paymentTotal ? 'DOWN' : 'FLAT';
  const netMagnitude = absDiff(creditTotal, paymentTotal);

  const entryCount = credits.length + payments.length;

  return {
    dateDisplay: window.dateDisplay,
    creditGivenDisplay: format.money(creditTotal),
    paymentsReceivedDisplay: format.money(paymentTotal),
    netChangeDisplay: format.money(netMagnitude),
    netDirection,
    entryCountDisplay: format.count(entryCount),
    goodsSoldCountDisplay: format.count(goodsSold.length),
    isEmpty: entryCount === 0 && goodsSold.length === 0,
    hasUnsynced: inWindow.some((event) => event.synced_at === null),
  };
}

// ---------------------------------------------------------------------------
// Customer detail — UI_SPEC screen 6, "Running balance, full history."
// ---------------------------------------------------------------------------

/**
 * `events` is this customer's own event slice (eventStore.eventsForCustomer),
 * not the whole log — customerHistory() filters and orders it, this file
 * only formats what comes back. No ordering or balance arithmetic happens
 * here; that is exactly what customerHistory() exists to own.
 */
export function buildCustomerDetailVM(
  customerRow: CustomerRowVM,
  events: readonly AnyEvent[],
  now: number,
  format: ViewModelFormatter,
): CustomerDetailVM {
  const lines = customerHistory(events, customerRow.id);

  const history: CustomerHistoryRowVM[] = lines
    .slice()
    .reverse() // most recent first, matching every other list in this app
    .map((line) => {
      const at =
        line.event.type === 'CREDIT_GIVEN' || line.event.type === 'PAYMENT_RECEIVED'
          ? (line.event.payload.occurred_at ?? line.event.created_at)
          : line.event.created_at;
      const daysAgo = daysSince(at, now);
      const amount =
        line.event.type === 'CREDIT_GIVEN' || line.event.type === 'PAYMENT_RECEIVED'
          ? line.event.payload.amount_poisha
          : (0 as Poisha);

      return {
        id: line.event.id,
        kind: line.event.type === 'CREDIT_GIVEN' ? 'CREDIT' : 'PAYMENT',
        amountDisplay: format.money(amount),
        balanceAfterDisplay: format.money(line.balance_after_poisha),
        whenDisplay: format.days(Math.max(daysAgo, 0)),
        voided: line.voided,
      };
    });

  return {
    id: customerRow.id,
    displayName: customerRow.displayName,
    phone: customerRow.phone,
    balanceDisplay: customerRow.balanceDisplay,
    daysSinceActivityDisplay: customerRow.daysSinceActivityDisplay,
    syncPending: customerRow.syncPending,
    history,
    isHistoryEmpty: history.length === 0,
  };
}
