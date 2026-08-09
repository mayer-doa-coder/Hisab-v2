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
// Functions. All four modules now exist (Steps 3-5). Each export's signature
// is checked against `Fold`, `ApplyCredit`, `ApplyPayment`, `ApplyCorrection`
// and `DetectAnomalies` below — that list was agreed in Step 2, so adding
// these exports is not a new decision.
// -----------------------------------------------------------------------------

export { fold } from './fold';
export { applyCredit, applyPayment, applyCorrection } from './commands';
export { detectAnomalies } from './anomalies';

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
  DomainError,
  DomainErrorCode,

  // Function signatures
  Fold,
  ApplyCredit,
  ApplyPayment,
  ApplyCorrection,
  DetectAnomalies,
} from './types';
