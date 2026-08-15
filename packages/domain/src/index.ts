// index.ts — the public API surface of @hisab/domain.
//
// SHARED: changing this file requires both team members to agree
// (AGENTS.md §2, CONTRIBUTING.md §2).
//
// This is the one sanctioned barrel file in the repository (AGENTS.md §4.9).
// It is deliberately narrow: four functions and the contract types. Anything
// not listed here is internal to the package, including money.ts — arithmetic
// on Poisha happens only inside the domain (AGENTS.md §3.2), so `add`,
// `subtract` and `fromTaka` are not exported. `toDisplayTaka` is not exported
// either: the domain hands the UI pre-formatted strings in the viewmodels, so
// no caller outside this package ever formats money itself.
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
  ViewModelFormatter,
  ViewModelOptions,

  // Commands and errors
  CommandContext,
  CreditCommand,
  PaymentCommand,
  CorrectionCommand,
  ArchiveCustomerCommand,
  DomainError,
  DomainErrorCode,

  // Function signatures
  Fold,
  ApplyCredit,
  ApplyPayment,
  ApplyCorrection,
  ApplyArchiveCustomer,
  DetectAnomalies,
} from './types';

// ValidationError is events.ts's own type (not types.ts's) — see events.ts's
// header comment on why it isn't folded into DomainError. Exported here for
// the same reason buildEvent is: callers outside the package need to be able
// to name the type of buildEvent's failure case.
export type { ValidationError } from './events';
