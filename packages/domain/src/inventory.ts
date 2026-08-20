// inventory.ts — EVENTS.md §4 and §7. The product/stock fold, plus the two
// derived rules the inventory screens need (low stock, expiry risk).
//
// THE NON-NEGOTIABLE RULE OF THIS FILE (AGENTS.md §3.3, and the specific v1
// bug it exists to prevent): stock on hand is ALWAYS a fold over movement
// events. There is no quantity field on ProductState, nothing here ever writes
// a quantity anywhere except into the `stock` Map it is currently building,
// and that Map is rebuilt from scratch on every call. v1 stored
// `Product.quantity` alongside `InventoryBatch.quantity` and needed
// `validateInventoryBatchConsistency()` because the two drifted under offline
// sync. The way you keep two numbers from drifting is to only ever have one.
//
// Kept out of fold.ts deliberately: fold.ts is the six core events and is the
// hottest, most-tested path in the system. This file is Phase 4 and should be
// separately readable and separately deletable.
//
// Zero I/O (AGENTS.md §3.1): no clock is read, no randomness. `now` is a
// parameter everywhere it is needed.
//
// Quantities are NOT money and deliberately do not go through money.ts: `unit`
// can be KG or LITRE, so 1.5 is a legitimate quantity. Only `_poisha` fields
// are branded integers (EVENTS.md §2).

import { collectVoidedIds, compareByHlc } from './ordering';
import type { AnyEvent, LedgerState, ProductState, StockLevel, StockState } from './types';

/**
 * Exactly the three `LedgerState` fields this fold owns, derived from
 * `LedgerState` with `Pick` rather than restated. If the shape of
 * `LedgerState.stock` ever changes in types.ts, this stops compiling instead of
 * silently producing a second, differently-shaped stock projection.
 */
export type InventoryProjections = Pick<LedgerState, 'products' | 'stock' | 'pendingProductIds'>;

/**
 * Applies a signed delta to a product's on-hand quantity. The only function in
 * the package that writes to a `stock` Map, and it only ever writes into the
 * Map being built by the current `foldInventory` call.
 */
function applyStockDelta(stock: Map<string, StockState>, productId: string, delta: number): void {
  const existing = stock.get(productId);
  const current = existing === undefined ? 0 : existing.quantity_units;
  stock.set(productId, { product_id: productId, quantity_units: current + delta });
}

/**
 * fold(events) for EVENTS.md §4's inventory events.
 *
 * Mirrors fold.ts's semantics exactly, on purpose:
 *  - sorts internally by hlc/device_id, so it is order-independent
 *  - a voided event never happened, movements included: voiding a STOCK_SOLD
 *    puts the units back, because the sale did not occur
 *  - a movement for a product with no PRODUCT_ADDED still creates a stock row,
 *    the same way CREDIT_GIVEN for an unknown customer still creates a balance
 *    row. Under offline sync the defining event may simply not have arrived
 *    yet, and refusing to count the movement would lose real data.
 *  - a PRODUCT_UPDATED / PRODUCT_ARCHIVED for an unknown product is skipped,
 *    the same way CUSTOMER_RENAMED for an unknown customer is: there is no row
 *    to modify, and inventing one would fabricate a name and a unit.
 */
export function foldInventory(events: readonly AnyEvent[]): InventoryProjections {
  const sorted = [...events].sort(compareByHlc);
  const voided = collectVoidedIds(sorted);

  const products = new Map<string, ProductState>();
  const stock = new Map<string, StockState>();
  const pendingProductIds = new Set<string>();

  for (const event of sorted) {
    const isVoided = event.type !== 'ENTRY_VOIDED' && voided.has(event.id);

    if (!isVoided) {
      switch (event.type) {
        case 'PRODUCT_ADDED': {
          const { product_id, name, unit, sale_price_poisha, low_stock_threshold_units } =
            event.payload;
          products.set(product_id, {
            id: product_id,
            name,
            unit,
            sale_price_poisha,
            low_stock_threshold_units,
            archived: false,
          });
          break;
        }
        case 'PRODUCT_UPDATED': {
          const existing = products.get(event.payload.product_id);
          if (!existing) break; // unknown product — nothing to update
          const p = event.payload;
          // Omitted = leave unchanged; explicit null = clear (EVENTS.md §2).
          products.set(existing.id, {
            ...existing,
            name: p.name === undefined ? existing.name : p.name,
            unit: p.unit === undefined ? existing.unit : p.unit,
            sale_price_poisha:
              p.sale_price_poisha === undefined ? existing.sale_price_poisha : p.sale_price_poisha,
            low_stock_threshold_units:
              p.low_stock_threshold_units === undefined
                ? existing.low_stock_threshold_units
                : p.low_stock_threshold_units,
          });
          break;
        }
        case 'PRODUCT_ARCHIVED': {
          const existing = products.get(event.payload.product_id);
          if (!existing) break;
          products.set(existing.id, { ...existing, archived: true });
          break;
        }
        case 'STOCK_RECEIVED':
          applyStockDelta(stock, event.payload.product_id, event.payload.quantity_units);
          break;
        case 'STOCK_SOLD':
          applyStockDelta(stock, event.payload.product_id, -event.payload.quantity_units);
          break;
        case 'STOCK_ADJUSTED':
          // Signed: DAMAGE/EXPIRY are negative, COUNT_CORRECTION can be either.
          applyStockDelta(stock, event.payload.product_id, event.payload.delta_units);
          break;
        default:
          // Core events belong to fold.ts. SALE_RECORDED is not a stock
          // movement — its line items are the STOCK_SOLD events beside it, and
          // folding both would double-count. §5 config events are Phase 5.
          break;
      }
    }

    // Sync-pending bookkeeping is independent of voided status, exactly as in
    // fold.ts: a voided write still has to reach the server.
    if (event.synced_at === null) {
      switch (event.type) {
        case 'PRODUCT_ADDED':
        case 'PRODUCT_UPDATED':
        case 'PRODUCT_ARCHIVED':
        case 'STOCK_RECEIVED':
        case 'STOCK_SOLD':
        case 'STOCK_ADJUSTED':
          pendingProductIds.add(event.payload.product_id);
          break;
        default:
          break;
      }
    }
  }

  return { products, stock, pendingProductIds };
}

// ---------------------------------------------------------------------------
// Low-stock rule. The bucketing is transcribed from the committed contract in
// apps/mobile/src/viewmodels/product.ts: "NEGATIVE < 0, OUT === 0, LOW when
// 0 < qty <= threshold, OK otherwise. A null threshold is never LOW."
// ---------------------------------------------------------------------------

export function stockLevel(
  quantityUnits: number,
  lowStockThresholdUnits: number | null,
): StockLevel {
  if (quantityUnits < 0) return 'NEGATIVE';
  if (quantityUnits === 0) return 'OUT';
  if (lowStockThresholdUnits !== null && quantityUnits <= lowStockThresholdUnits) return 'LOW';
  return 'OK';
}

// ---------------------------------------------------------------------------
// Expiry. THE SIMPLIFIED, NON-FEFO RULE.
//
// EVENTS.md §4 is explicit that `STOCK_RECEIVED.expiry_date` is recorded but
// not folded, because `STOCK_SOLD` carries no reference to the batch it drew
// from. The fold therefore knows the total on hand but not WHICH batches
// remain, and `earliest_expiry` was removed from the `stock` projection for
// exactly that reason (DECISIONS.md 2026-08-08).
//
// So this function assumes NO consumption order at all — not FEFO, not FIFO,
// not LIFO. It reports the one thing that is true under every possible
// consumption order:
//
//     at most min(on_hand, units received in already-expired batches)
//     of the units on the shelf right now can be expired.
//
// That bound is sound whichever batch the shopkeeper actually sold from, and it
// collapses to nothing as soon as the product is sold out, which kills the
// largest class of false alarm a naive "any past expiry_date" scan produces.
//
// It takes the event slice as a parameter rather than reading it off a
// projection, mirroring `detectAnomalies(state, events)` and for the same
// reason (DECISIONS.md 2026-08-08, "LedgerState does not retain the events it
// folded"): the caller owns the memory decision, and no batch data is smuggled
// into a projection that EVENTS.md §7 deliberately does not have.
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parses a strict `YYYY-MM-DD` into epoch ms at UTC midnight, or null if the
 * string is not that shape or names a day that does not exist. `Date.UTC` is a
 * pure static computation and `new Date(ms)` takes an explicit argument — no
 * clock is read, so this stays inside AGENTS.md §3.1.
 *
 * Deliberately not `Date.parse`: it accepts a pile of other formats whose
 * interpretation is implementation-defined, and `expiry_date` is a free
 * `z.string()` in the schema, so malformed input is genuinely reachable.
 */
export function parseIsoDateUtc(value: string): number | null {
  const match = ISO_DATE.exec(value);
  if (match === null) return null;
  const [, y, m, d] = match;
  if (y === undefined || m === undefined || d === undefined) return null;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const ms = Date.UTC(year, month - 1, day);
  // Round-trip check: rejects 2026-02-31 and 2026-13-01, which Date.UTC would
  // otherwise silently roll over into the following month.
  const round = new Date(ms);
  if (
    round.getUTCFullYear() !== year ||
    round.getUTCMonth() !== month - 1 ||
    round.getUTCDate() !== day
  ) {
    return null;
  }
  return ms;
}

/**
 * A batch counts as expired once its expiry DAY has fully elapsed in UTC, i.e.
 * `now >= midnight(expiry_date) + 1 day`. Bangladesh is UTC+6 with no DST, so
 * this fires about six hours after local end-of-day: late, never early. Erring
 * late is the right direction — a false "this is expired" at the counter costs
 * the shopkeeper saleable stock, a six-hour delay costs nothing.
 */
function isExpired(expiryDateUtcMs: number, now: number): boolean {
  return now >= expiryDateUtcMs + DAY_MS;
}

export interface ExpiryRisk {
  readonly product_id: string;
  /** Units received in batches whose expiry day has fully elapsed. */
  readonly expired_batch_units: number;
  /** Units on hand right now, straight from the fold. */
  readonly on_hand_units: number;
  /**
   * `min(on_hand_units, expired_batch_units)` — an upper bound that holds under
   * ANY consumption order, because no event says which batch was sold. Always
   * greater than zero for a reported risk. This is the number to put in front
   * of the shopkeeper, phrased as "at most", never as "you have N expired
   * units" (AGENTS.md §4.8: facts, not scores, and not overstated facts).
   */
  readonly at_most_expired_units: number;
  /** Earliest expiry date among the expired batches. ISO `YYYY-MM-DD`. */
  readonly earliest_expired_date: string;
}

/**
 * Products that could be holding expired stock, given what the events can
 * actually support. Archived products are skipped. Products with nothing on
 * hand are skipped — if it sold out, nothing expired is on the shelf, whichever
 * batch it came from.
 *
 * Sorted by `earliest_expired_date` then `product_id`, so the output is
 * deterministic for a given input — the same guarantee the folds give.
 */
export function expiryRisks(
  state: InventoryProjections,
  events: readonly AnyEvent[],
  now: number,
): ExpiryRisk[] {
  const voided = collectVoidedIds(events);

  const expiredUnits = new Map<string, number>();
  const earliestDate = new Map<string, string>();

  for (const event of events) {
    if (event.type !== 'STOCK_RECEIVED') continue;
    if (voided.has(event.id)) continue; // a voided receipt never happened
    const { product_id, quantity_units, expiry_date } = event.payload;
    if (expiry_date === null) continue; // no expiry recorded — nothing to say
    const parsed = parseIsoDateUtc(expiry_date);
    if (parsed === null) continue; // malformed; reporting that is not this function's job
    if (!isExpired(parsed, now)) continue;

    expiredUnits.set(product_id, (expiredUnits.get(product_id) ?? 0) + quantity_units);
    const seen = earliestDate.get(product_id);
    if (seen === undefined || expiry_date < seen) {
      earliestDate.set(product_id, expiry_date); // ISO dates sort lexicographically
    }
  }

  const risks: ExpiryRisk[] = [];
  for (const [product_id, expired_batch_units] of expiredUnits) {
    const product = state.products.get(product_id);
    if (product !== undefined && product.archived) continue;

    const on_hand_units = state.stock.get(product_id)?.quantity_units ?? 0;
    // Sold out, or negative — a negative on-hand is the NEGATIVE_STOCK anomaly
    // (anomalies.ts), a data problem, not an expiry problem.
    if (on_hand_units <= 0) continue;

    const at_most_expired_units = Math.min(on_hand_units, expired_batch_units);
    if (at_most_expired_units <= 0) continue;

    const earliest_expired_date = earliestDate.get(product_id);
    if (earliest_expired_date === undefined) continue; // unreachable: set alongside expiredUnits

    risks.push({
      product_id,
      expired_batch_units,
      on_hand_units,
      at_most_expired_units,
      earliest_expired_date,
    });
  }

  risks.sort((a, b) => {
    if (a.earliest_expired_date !== b.earliest_expired_date) {
      return a.earliest_expired_date < b.earliest_expired_date ? -1 : 1;
    }
    if (a.product_id !== b.product_id) return a.product_id < b.product_id ? -1 : 1;
    return 0;
  });
  return risks;
}
