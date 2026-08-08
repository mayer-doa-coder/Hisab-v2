// types.ts — the A↔B contract. SHARED: changing anything here requires both
// team members to agree (AGENTS.md §2, CONTRIBUTING.md §2).
//
// Every payload below is transcribed from docs/EVENTS.md §3–§5. That file is
// authoritative: if this file and EVENTS.md disagree, EVENTS.md wins and the
// disagreement is a bug. Nothing here may be added without the six-item
// checklist in EVENTS.md §9.
//
// Zero I/O (AGENTS.md §3.1). The only import in this file is the money brand.

import type { Poisha } from './money';

// Re-exported so consumers get the whole contract from one place. The money
// *functions* stay internal — arithmetic happens only in money.ts (§3.2).
export type { Poisha, Taka } from './money';

// -----------------------------------------------------------------------------
// Enumerations. Values are verbatim from EVENTS.md; the type names are ours.
// -----------------------------------------------------------------------------

/** EVENTS.md §3 `CUSTOMER_ARCHIVED`. `REQUESTED` is the erasure path (SECURITY.md). */
export type CustomerArchiveReason = 'DUPLICATE' | 'INACTIVE' | 'REQUESTED';

/** EVENTS.md §3 `ENTRY_VOIDED`. */
export type VoidReason = 'MISTAKE' | 'DUPLICATE' | 'DISPUTED';

/** EVENTS.md §4 `PRODUCT_ADDED`. */
export type ProductUnit = 'PIECE' | 'KG' | 'GRAM' | 'LITRE' | 'ML' | 'PACKET' | 'DOZEN';

/** EVENTS.md §4 `STOCK_ADJUSTED`. */
export type StockAdjustmentReason =
  | 'DAMAGE'
  | 'EXPIRY'
  | 'COUNT_CORRECTION'
  | 'GIFT'
  | 'OTHER';

/** EVENTS.md §4 `SALE_RECORDED`. */
export type PaymentMethod = 'CASH' | 'CREDIT' | 'MIXED';

/** EVENTS.md §5 `SEASONAL_MULTIPLIER_SET`. */
export type Season = 'RAMADAN' | 'EID_UL_FITR' | 'EID_UL_ADHA' | 'MONSOON' | 'HARVEST';

// -----------------------------------------------------------------------------
// §3 — Core events. Phase 1 and 2. These six carry the entire core product.
//
// Payload fields are snake_case, not camelCase. They are serialised straight to
// the `payload` JSON column and read back by both the app and the server, so
// they follow the database convention rather than AGENTS.md §6's TypeScript
// one. Viewmodels are camelCase. See EVENTS.md §2.
// -----------------------------------------------------------------------------

export interface CustomerAddedPayload {
  readonly schema_version: 1;
  /** UUIDv7, generated on-device. */
  readonly customer_id: string;
  /** The nickname — what the shopkeeper calls them. The only required field. */
  readonly display_name: string;
  /** E.164 or local format, as typed. */
  readonly phone: string | null;
}

/** Omitted field = leave unchanged. Explicit `null` = clear the value. */
export interface CustomerRenamedPayload {
  readonly schema_version: 1;
  readonly customer_id: string;
  readonly display_name: string;
  readonly phone?: string | null;
}

export interface CustomerArchivedPayload {
  readonly schema_version: 1;
  readonly customer_id: string;
  readonly reason: CustomerArchiveReason;
}

/** বাকি. The single most important event in the system (EVENTS.md §3). */
export interface CreditGivenPayload {
  readonly schema_version: 1;
  readonly entry_id: string;
  readonly customer_id: string;
  /** Positive integer. */
  readonly amount_poisha: Poisha;
  readonly note: string | null;
  /** Set if the user backdated the entry; null means "now". */
  readonly occurred_at: number | null;
}

/**
 * জমা. Deliberately has no `applies_to_entry_id` — payments are against the
 * running balance, not against specific credit entries (EVENTS.md §3).
 */
export interface PaymentReceivedPayload {
  readonly schema_version: 1;
  readonly entry_id: string;
  readonly customer_id: string;
  /** Positive integer. */
  readonly amount_poisha: Poisha;
  readonly note: string | null;
  readonly occurred_at: number | null;
}

/**
 * The only way to undo anything, for every event type — including
 * `CUSTOMER_ARCHIVED`, which is otherwise irreversible. The original event is
 * never removed; the fold skips events a later `ENTRY_VOIDED` references. Two
 * voids of the same target have the same effect as one — property test.
 */
export interface EntryVoidedPayload {
  readonly schema_version: 1;
  /** Id of any event being voided. */
  readonly voids_event_id: string;
  readonly reason: VoidReason;
}

// -----------------------------------------------------------------------------
// §4 — Inventory events. Phase 4. Shapes are frozen here; nothing folds them
// until the six core screens have been in a real shop for two weeks.
// -----------------------------------------------------------------------------

/**
 * No `quantity` field: stock is a fold over movement events. No `expiry_date`
 * either — expiry belongs to a batch, not to a product type. v1 stored both and
 * needed `validateInventoryBatchConsistency` because they drifted.
 */
export interface ProductAddedPayload {
  readonly schema_version: 1;
  readonly product_id: string;
  readonly name: string;
  readonly unit: ProductUnit;
  readonly sale_price_poisha: Poisha | null;
  readonly low_stock_threshold_units: number | null;
}

/** Omitted field = leave unchanged. Explicit `null` = clear the value. */
export interface ProductUpdatedPayload {
  readonly schema_version: 1;
  readonly product_id: string;
  readonly name?: string;
  readonly unit?: ProductUnit;
  readonly sale_price_poisha?: Poisha | null;
  readonly low_stock_threshold_units?: number | null;
}

export interface ProductArchivedPayload {
  readonly schema_version: 1;
  readonly product_id: string;
}

export interface StockReceivedPayload {
  readonly schema_version: 1;
  readonly movement_id: string;
  readonly product_id: string;
  /** Positive. */
  readonly quantity_units: number;
  readonly cost_price_poisha: Poisha | null;
  /**
   * ISO date. On the batch, not the product. Recorded but not folded: no event
   * links a `STOCK_SOLD` to the batch it drew from, so the fold cannot know
   * which batches remain. See EVENTS.md §4 and DECISIONS.md 2026-08-08.
   */
  readonly expiry_date: string | null;
  readonly occurred_at: number | null;
}

export interface StockSoldPayload {
  readonly schema_version: 1;
  readonly movement_id: string;
  readonly product_id: string;
  /** Positive; the fold subtracts. */
  readonly quantity_units: number;
  readonly sale_price_poisha: Poisha;
  /** Links the line items of one sale. */
  readonly sale_id: string | null;
  readonly occurred_at: number | null;
}

export interface StockAdjustedPayload {
  readonly schema_version: 1;
  readonly movement_id: string;
  readonly product_id: string;
  /** Signed — can be negative. */
  readonly delta_units: number;
  readonly reason: StockAdjustmentReason;
  readonly note: string | null;
}

/**
 * A `MIXED` or `CREDIT` sale emits both this and a `CREDIT_GIVEN` in one batch,
 * sharing `occurred_at`. The domain produces both from one command; the UI never
 * emits two separately.
 */
export interface SaleRecordedPayload {
  readonly schema_version: 1;
  readonly sale_id: string;
  /** null = walk-in cash sale. */
  readonly customer_id: string | null;
  /** What was agreed at the counter — a fact, not a cache. See EVENTS.md §4. */
  readonly total_poisha: Poisha;
  readonly payment_method: PaymentMethod;
  /** The remainder becomes credit. */
  readonly cash_paid_poisha: Poisha;
  readonly occurred_at: number | null;
}

// -----------------------------------------------------------------------------
// §5 — Configuration events. Phase 5.
// -----------------------------------------------------------------------------

/**
 * Shopkeeper-editable rather than a hidden model weight. The shopkeeper knows
 * Eid demand better than the model does, and what they choose is research data
 * nobody else has.
 */
export interface SeasonalMultiplierSetPayload {
  readonly schema_version: 1;
  /** null = applies to all products. */
  readonly product_id: string | null;
  readonly season: Season;
  /** e.g. 2.0 — set by the shopkeeper, not learned. Not money; not Poisha. */
  readonly multiplier: number;
}

export interface ReorderSettingsSetPayload {
  readonly schema_version: 1;
  readonly product_id: string | null;
  readonly lead_time_days: number | null;
  /** 0..1 */
  readonly service_level: number | null;
}

// -----------------------------------------------------------------------------
// The envelope. EVENTS.md §1.
// -----------------------------------------------------------------------------

/**
 * One entry per event type. This map is the single source of truth for both
 * `EventType` and `PayloadFor`, so the three can never drift apart.
 */
export interface EventPayloads {
  readonly CUSTOMER_ADDED: CustomerAddedPayload;
  readonly CUSTOMER_RENAMED: CustomerRenamedPayload;
  readonly CUSTOMER_ARCHIVED: CustomerArchivedPayload;
  readonly CREDIT_GIVEN: CreditGivenPayload;
  readonly PAYMENT_RECEIVED: PaymentReceivedPayload;
  readonly ENTRY_VOIDED: EntryVoidedPayload;
  readonly PRODUCT_ADDED: ProductAddedPayload;
  readonly PRODUCT_UPDATED: ProductUpdatedPayload;
  readonly PRODUCT_ARCHIVED: ProductArchivedPayload;
  readonly STOCK_RECEIVED: StockReceivedPayload;
  readonly STOCK_SOLD: StockSoldPayload;
  readonly STOCK_ADJUSTED: StockAdjustedPayload;
  readonly SALE_RECORDED: SaleRecordedPayload;
  readonly SEASONAL_MULTIPLIER_SET: SeasonalMultiplierSetPayload;
  readonly REORDER_SETTINGS_SET: ReorderSettingsSetPayload;
}

export type EventType = keyof EventPayloads;

export type PayloadFor<T extends EventType> = EventPayloads[T];

export interface Event<T extends EventType = EventType> {
  /** UUIDv7, generated on-device. Also the idempotency key. */
  readonly id: string;
  readonly device_id: string;
  /** Monotonic per device, starts at 1, never reused. */
  readonly seq: number;
  /** Hybrid logical clock — the ordering key. */
  readonly hlc: string;
  readonly shop_id: string;
  readonly type: T;
  readonly payload: PayloadFor<T>;
  /** Device wall clock, epoch ms. UNTRUSTED — display only. */
  readonly created_at: number;
  /** null = not yet pushed to server. Device-local; never replicated. */
  readonly synced_at: number | null;
}

/**
 * `Event<EventType>` does not correlate `type` with `payload`, so it cannot be
 * narrowed by a `switch (e.type)`. This distributed form can. Use it wherever a
 * heterogeneous list of events is handled — the fold, the log, anomalies.
 */
export type AnyEvent = { [T in EventType]: Event<T> }[EventType];

// -----------------------------------------------------------------------------
// Anomalies. EVENTS.md §8. Detected after the fold, never blocking a write.
// -----------------------------------------------------------------------------

export type Anomaly =
  | {
      readonly kind: 'NEGATIVE_BALANCE';
      readonly customer_id: string;
      readonly amount_poisha: Poisha;
      readonly candidates: readonly AnyEvent[];
    }
  | {
      readonly kind: 'NEGATIVE_STOCK';
      readonly product_id: string;
      readonly quantity_units: number;
      readonly candidates: readonly AnyEvent[];
    }
  | {
      readonly kind: 'DUPLICATE_SUSPECTED';
      readonly events: readonly [AnyEvent, AnyEvent];
    };

// =============================================================================
// Folded state. Shapes follow the projection key columns in EVENTS.md §7.
// =============================================================================

/** EVENTS.md §7, `customers` projection. */
export interface CustomerState {
  readonly id: string;
  readonly display_name: string;
  readonly phone: string | null;
  readonly archived: boolean;
}

/** EVENTS.md §7, `balances` projection. */
export interface BalanceState {
  readonly customer_id: string;
  /** Positive = the customer owes the shop. */
  readonly balance_poisha: Poisha;
  /**
   * `occurred_at ?? created_at` of the newest non-voided entry; null if there
   * has never been one. Device wall clock, and therefore untrusted (EVENTS.md
   * §1 invariant 2) — see DECISIONS.md 2026-08-08 on aging.
   */
  readonly last_activity_at: number | null;
}

/** EVENTS.md §7, `products` projection. */
export interface ProductState {
  readonly id: string;
  readonly name: string;
  readonly unit: ProductUnit;
  readonly sale_price_poisha: Poisha | null;
  readonly low_stock_threshold_units: number | null;
  readonly archived: boolean;
}

/** EVENTS.md §7, `stock` projection. */
export interface StockState {
  readonly product_id: string;
  readonly quantity_units: number;
}

/** EVENTS.md §7, `daily_sales` projection. Feeds the forecaster. */
export interface DailySales {
  readonly product_id: string;
  /** ISO date. */
  readonly date: string;
  readonly quantity_units: number;
}

/**
 * The result of folding the log. Derived, droppable, never a source of truth.
 *
 * It deliberately does NOT retain the events it consumed: holding the whole log
 * in the heap is the v1 god-context bug (AGENTS.md §4.2). `detectAnomalies`
 * takes the event slice it needs as a separate argument, so the caller decides
 * how much log to keep in memory.
 */
export interface LedgerState {
  readonly customers: ReadonlyMap<string, CustomerState>;
  readonly balances: ReadonlyMap<string, BalanceState>;
  readonly products: ReadonlyMap<string, ProductState>;
  readonly stock: ReadonlyMap<string, StockState>;
  /** Event ids referenced by an `ENTRY_VOIDED`; the fold skips them. */
  readonly voided: ReadonlySet<string>;
  /**
   * Customers and products with at least one event where `synced_at === null`.
   * Device-local: two devices folding the same log get different sets, which is
   * correct — sync state is per-device and must not replicate (EVENTS.md §6).
   */
  readonly pendingCustomerIds: ReadonlySet<string>;
  readonly pendingProductIds: ReadonlySet<string>;
}

export type DomainErrorCode =
  | 'UNKNOWN_CUSTOMER'
  | 'CUSTOMER_IS_ARCHIVED'
  | 'AMOUNT_NOT_POSITIVE'
  | 'AMOUNT_NOT_INTEGER'
  | 'UNKNOWN_EVENT';

/**
 * Errors are values in the domain layer (AGENTS.md §6) — commands return this,
 * they never throw. Discriminated from a success result by `Array.isArray`.
 * `message` is for the developer and the log; it is never rendered. User-facing
 * text is B's, via `t()`.
 */
export interface DomainError {
  readonly code: DomainErrorCode;
  readonly message: string;
}

/**
 * Ids, the device identity and the clock are all inputs, never generated inside
 * the domain: `new Date()` and `crypto.randomUUID()` are I/O, and a fold that
 * reads the clock is not deterministic (AGENTS.md §3.1).
 */
export interface CommandContext {
  readonly event_id: string;
  readonly device_id: string;
  readonly seq: number;
  readonly hlc: string;
  readonly shop_id: string;
  readonly created_at: number;
}

export interface CreditCommand {
  readonly ctx: CommandContext;
  readonly entry_id: string;
  readonly customer_id: string;
  readonly amount_poisha: Poisha;
  readonly note: string | null;
  readonly occurred_at: number | null;
}

export interface PaymentCommand {
  readonly ctx: CommandContext;
  readonly entry_id: string;
  readonly customer_id: string;
  readonly amount_poisha: Poisha;
  readonly note: string | null;
  readonly occurred_at: number | null;
}

/** Emits `ENTRY_VOIDED` — the only correction mechanism in the system. */
export interface CorrectionCommand {
  readonly ctx: CommandContext;
  readonly voids_event_id: string;
  readonly reason: VoidReason;
}

// =============================================================================
// The viewmodel boundary (CONTRIBUTING.md §2).
//
// The domain decides WHAT to say; B decides how it reads in Bengali. The domain
// therefore never contains a user-facing string, and B never decides who is
// overdue or does arithmetic on money. `ViewModelFormatter` is the seam: B
// implements it over `t()` and the numeral-script setting, and passes it in.
// =============================================================================

/**
 * A fact about a customer or product that deserves the shopkeeper's attention.
 * Facts, not scores (AGENTS.md §4.8) — there is no severity field and never a
 * risk band, because the counter phone faces the customer.
 */
export type AttentionReason =
  | { readonly kind: 'NO_ACTIVITY'; readonly days: number }
  | { readonly kind: 'BALANCE_NEGATIVE' }
  | { readonly kind: 'STOCK_LOW'; readonly remaining_units: number }
  | { readonly kind: 'STOCK_OUT' }
  | { readonly kind: 'STOCK_NEGATIVE' };

/**
 * Implemented by B in `apps/mobile/src/i18n/`, passed into the viewmodel
 * builders. Every method returns a string already in the user's language and
 * numeral script, with Indian digit grouping (AGENTS.md §6).
 */
export interface ViewModelFormatter {
  /** e.g. `12,34,567` — grouping and numeral script are B's concern. */
  money(amount: Poisha): string;
  days(count: number): string;
  quantity(count: number, unit: ProductUnit): string;
  unit(unit: ProductUnit): string;
  attention(reason: AttentionReason): string;
}

/**
 * Everything a viewmodel builder needs that the fold cannot supply. `now` is
 * passed in because the domain may not read the clock (AGENTS.md §3.1) — every
 * elapsed-time field in a viewmodel is a function of this value.
 */
export interface ViewModelOptions {
  /** Epoch ms, supplied by the caller at render time. */
  readonly now: number;
  readonly format: ViewModelFormatter;
}

// -----------------------------------------------------------------------------
// Signatures of the exported functions, declared here so the contract can be
// agreed before fold.ts, commands.ts and anomalies.ts are written.
// -----------------------------------------------------------------------------

export type Fold = (events: readonly AnyEvent[]) => LedgerState;
export type ApplyCredit = (state: LedgerState, cmd: CreditCommand) => AnyEvent[] | DomainError;
export type ApplyPayment = (state: LedgerState, cmd: PaymentCommand) => AnyEvent[] | DomainError;
export type ApplyCorrection = (
  state: LedgerState,
  cmd: CorrectionCommand,
) => AnyEvent[] | DomainError;

/**
 * Takes the event slice separately rather than reading it off `LedgerState`, so
 * the caller controls how many events are in memory (AGENTS.md §4.2).
 */
export type DetectAnomalies = (
  state: LedgerState,
  events: readonly AnyEvent[],
) => Anomaly[];
