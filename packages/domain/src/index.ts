// index.ts — the public API surface of @hisab/domain.
//
// SHARED: changing this file requires both team members to agree
// (AGENTS.md §2, CONTRIBUTING.md §2).
//
// This is the one sanctioned barrel file in the repository (AGENTS.md §4.9).
// It is deliberately narrow: four functions and the contract types. Anything
// not listed here is internal to the package, including money.ts — arithmetic
// on Poisha happens only inside the domain (AGENTS.md §3.2), so `add`,
// `subtract` and `fromTaka` are not exported.
//
// `toDisplayTaka` IS exported, as of Step 13, and the reason is a correction:
// this comment used to say it was withheld because "the domain hands the UI
// pre-formatted strings in the viewmodels, so no caller outside this package
// ever formats money itself." That was not implementable. `ViewModelFormatter`
// (types.ts) declares `money(amount: Poisha): string` and says in its own
// docstring that B implements it in `apps/mobile/src/i18n/` — so the one
// component that produces those "pre-formatted strings" lives OUTSIDE this
// package by design, and had no sanctioned way to divide Poisha by 100.
// Exporting the single tested function that does that division inside money.ts
// is strictly better than the alternative, which is the UI doing `/ 100`
// itself and breaking AGENTS.md §3.2 for real. The formatter still does no
// arithmetic: it takes the string and applies grouping and numeral script.
//
// Zero I/O (AGENTS.md §3.1).

// -----------------------------------------------------------------------------
// Functions. `fold`/`applyCredit`/`applyPayment`/`applyCorrection`/
// `detectAnomalies` were agreed in Step 2 (checked against `Fold`,
// `ApplyCredit`, etc. below). `buildEvent` was NOT anticipated then — it is
// added here in Step 9 because the data layer (apps/mobile/src/data/) needs
// to validate payloads before writing, and re-implementing that validation
// outside this package would duplicate Step 4's Zod schemas (AGENTS.md §4.3:
// "Never duplicate logic across client and server"). This is a genuinely new
// addition to a jointly-owned file, not a pre-agreed one — flagged in Step 9's
// report, not silently committed.
// -----------------------------------------------------------------------------

// applyArchiveCustomer added Step 11 (audit item 7) — see commands.ts and
// types.ts's ArchiveCustomerCommand/ApplyArchiveCustomer for why this was a
// real gap, not a deferred feature. SHARED-file change, flagged in this
// step's report.
export { fold } from './fold';
export { applyCredit, applyPayment, applyCorrection, applyArchiveCustomer } from './commands';
export { detectAnomalies } from './anomalies';
export { buildEvent } from './events';

// The ONLY money function exported. See the header note above: it is what
// makes ViewModelFormatter.money implementable without arithmetic in the UI.
export { toDisplayTaka } from './money';

// Aggregation helpers, exported Step 13. `add`/`subtract`/`fromTaka` stay
// internal — these two exist because summing balances for the aging total and
// the daily summary IS money arithmetic, and doing it in a `+=` loop in
// apps/mobile/src/data/ would break AGENTS.md §3.2 in a way the eslint guard
// does not catch (its selector keys on `_poisha` identifier names, and a local
// accumulator is not called that). Better to export the operation than to let
// the rule be broken quietly.
export { sumPoisha, absDiff } from './money';

// -----------------------------------------------------------------------------
// Step 12 — inventory (EVENTS.md §4) and the attention rules.
//
// `customerAttention` is the one that changes existing behaviour: it replaces
// the `needsAttention: false` / `attentionReason: null` stub that Step 7 left
// in apps/mobile/src/data/viewmodels.ts. The header of
// apps/mobile/src/viewmodels/customer.ts says B "never decides who is
// overdue" — this export is where that decision actually lives, so it has to
// cross the package boundary.
//
// ordering.ts is deliberately NOT exported: how the domain sorts a log is an
// internal guarantee, not something a caller should be able to reach around.
// -----------------------------------------------------------------------------
export { foldInventory, stockLevel, expiryRisks, parseIsoDateUtc } from './inventory';
export {
  addProduct,
  receiveStock,
  adjustStock,
  recordSale,
  saleEventCount,
} from './inventoryCommands';
export {
  customerAttention,
  productAttention,
  daysSince,
  NO_ACTIVITY_ATTENTION_DAYS,
} from './attention';

// -----------------------------------------------------------------------------
// Step 14 (six core screens) — customer detail's running-balance history.
// See history.ts's header on why this could not be built from fold()'s
// output alone: LedgerState deliberately does not retain the events it
// folded (DECISIONS.md 2026-08-08), and a running balance per line is a
// different shape from a final balance. SHARED-file change, flagged here
// rather than made silently.
// -----------------------------------------------------------------------------
export { customerHistory } from './history';

// -----------------------------------------------------------------------------
// The contract types. types.ts is the authority on shape; docs/EVENTS.md is the
// authority on meaning.
// -----------------------------------------------------------------------------

export type {
  // Money
  Poisha,
  Taka,

  // Envelope — EVENTS.md §1
  Event,
  AnyEvent,
  EventType,
  EventPayloads,
  PayloadFor,

  // Enumerations
  CustomerArchiveReason,
  VoidReason,
  ProductUnit,
  StockAdjustmentReason,
  PaymentMethod,
  Season,

  // Core payloads — EVENTS.md §3
  CustomerAddedPayload,
  CustomerRenamedPayload,
  CustomerArchivedPayload,
  CreditGivenPayload,
  PaymentReceivedPayload,
  EntryVoidedPayload,

  // Inventory payloads — EVENTS.md §4
  ProductAddedPayload,
  ProductUpdatedPayload,
  ProductArchivedPayload,
  StockReceivedPayload,
  StockSoldPayload,
  StockAdjustedPayload,
  SaleRecordedPayload,

  // Configuration payloads — EVENTS.md §5
  SeasonalMultiplierSetPayload,
  ReorderSettingsSetPayload,

  // Anomalies — EVENTS.md §8
  Anomaly,

  // Folded state and projections — EVENTS.md §7
  LedgerState,
  CustomerState,
  BalanceState,
  ProductState,
  StockState,
  DailySales,

  // The viewmodel boundary — CONTRIBUTING.md §2
  AttentionReason,
  StockLevel,
  ViewModelFormatter,
  ViewModelOptions,

  // Commands and errors
  CommandContext,
  CreditCommand,
  PaymentCommand,
  CorrectionCommand,
  ArchiveCustomerCommand,
  AddProductCommand,
  ReceiveStockCommand,
  AdjustStockCommand,
  RecordSaleCommand,
  SaleLineItem,
  DomainError,
  DomainErrorCode,

  // Function signatures
  Fold,
  ApplyCredit,
  ApplyPayment,
  ApplyCorrection,
  ApplyArchiveCustomer,
  ApplyAddProduct,
  ApplyReceiveStock,
  ApplyAdjustStock,
  ApplyRecordSale,
  DetectAnomalies,
} from './types';

// inventory.ts's own types, the same way ValidationError is events.ts's own:
// InventoryProjections is a Pick over LedgerState, and ExpiryRisk describes
// what the non-FEFO expiry rule can honestly report. Neither belongs in
// types.ts, because neither is part of the A<->B viewmodel contract.
export type { InventoryProjections, ExpiryRisk } from './inventory';
export type { CustomerAttentionInput } from './attention';
export type { CustomerHistoryLine } from './history';

// ValidationError is events.ts's own type (not types.ts's) — see events.ts's
// header comment on why it isn't folded into DomainError. Exported here for
// the same reason buildEvent is: callers outside the package need to be able
// to name the type of buildEvent's failure case.
export type { ValidationError } from './events';
