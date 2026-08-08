// product.ts — viewmodels for the inventory screens.
//
// SHARED: changing this file requires both team members to agree
// (AGENTS.md §2, CONTRIBUTING.md §2).
//
// Same contract as customer.ts: A produces, B renders, every field is a display
// string or a boolean/enum, and every field is annotated with its derivation.
// No imports.
//
// Inventory is Phase 4 (EVENTS.md §4) — nothing renders this yet. The shape is
// written now only because CONTRIBUTING.md §2 says all three shared files are
// agreed in one Phase 0 session, and it is expected to change once a shopkeeper
// has actually used inventory. See DECISIONS.md 2026-08-08.

/**
 * Stock status, bucketed by the domain against `low_stock_threshold_units`:
 * NEGATIVE < 0, OUT === 0, LOW when 0 < qty ≤ threshold, OK otherwise.
 * A null threshold is never LOW. NEGATIVE is how the UI surfaces the
 * NEGATIVE_STOCK anomaly (EVENTS.md §8) instead of rendering a nonsense number.
 */
export type StockLevel = 'OK' | 'LOW' | 'OUT' | 'NEGATIVE';

/** One row in the product list. */
export interface ProductRowVM {
  /** ← PRODUCT_ADDED.product_id */
  id: string;
  /** ← PRODUCT_ADDED.name, superseded by the latest PRODUCT_UPDATED. */
  name: string;
  /** ← ProductState.unit → format.unit(), e.g. "কেজি". Never the raw enum. */
  unitLabel: string;
  /** ← ProductState.sale_price_poisha → format.money(). null = none recorded. */
  priceDisplay: string | null;
  /**
   * ← fold(STOCK_RECEIVED + STOCK_ADJUSTED − STOCK_SOLD) → format.quantity().
   * Stock is a fold, never a stored field — that was the v1 bug.
   */
  stockDisplay: string;
  /** ← the same quantity compared against ProductState.low_stock_threshold_units */
  stockLevel: StockLevel;
  /** ← domain rule over the same inputs. Computed by domain, rendered by UI. */
  needsAttention: boolean;
  /** ← AttentionReason → format.attention(). Facts, not scores. */
  attentionReason: string | null;
  /** ← LedgerState.pendingProductIds (envelope `synced_at === null`) */
  syncPending: boolean;
}
