// schema.ts — the events table exactly per docs/EVENTS.md §1, plus the
// customers and balances projection tables per §7's key columns. Backend-
// agnostic: plain SQL strings, no expo-sqlite or sql.js import.
//
// sync_pending is deliberately NOT a column here — DECISIONS.md 2026-08-08:
// "Sync state is exposed as id sets, not projection columns... device-local
// and must not replicate." Adding it as a column would make two devices'
// otherwise-identical projections differ, breaking the rebuild test's
// "byte-identical" guarantee. See eventStore.ts's syncPending query instead.
//
// json_extract (SQLite's built-in JSON support, core since 3.38) is used to
// index and query payload.customer_id without a denormalised column.

export const EVENTS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  device_id   TEXT    NOT NULL,
  seq         INTEGER NOT NULL,
  hlc         TEXT    NOT NULL,
  shop_id     TEXT    NOT NULL,
  type        TEXT    NOT NULL,
  payload     TEXT    NOT NULL,     -- JSON
  created_at  INTEGER NOT NULL,
  synced_at   INTEGER,
  UNIQUE (device_id, seq)
);
`;

export const EVENTS_INDEXES_SQL = `
CREATE INDEX IF NOT EXISTS idx_events_hlc      ON events (hlc);
CREATE INDEX IF NOT EXISTS idx_events_unsynced ON events (synced_at) WHERE synced_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_events_customer ON events (json_extract(payload, '$.customer_id'));
CREATE INDEX IF NOT EXISTS idx_events_voids    ON events (json_extract(payload, '$.voids_event_id'));
`;

/** EVENTS.md §7: `customers` — derived from CUSTOMER_*, droppable, rebuildable. */
export const CUSTOMERS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS customers (
  id           TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  phone        TEXT,
  archived     INTEGER NOT NULL DEFAULT 0
);
`;

/** EVENTS.md §7: `balances` — derived from CREDIT_GIVEN/PAYMENT_RECEIVED/ENTRY_VOIDED. */
export const BALANCES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS balances (
  customer_id      TEXT PRIMARY KEY,
  balance_poisha    INTEGER NOT NULL,
  last_activity_at INTEGER
);
`;

/**
 * Local-only timing instrumentation (UI_SPEC.md acceptance criteria: credit
 * entry < 8s, ≤5 taps — "measured in a real shop"; this is the automatic
 * cross-check alongside the stopwatch, not a replacement for it). Not an
 * event: EVENTS.md §6's "Deliberately not events" table already excludes
 * exactly this category (operational/diagnostic data, not a fact about the
 * shop's ledger). Never folded, never synced — no sync exists yet (Step 10),
 * and SECURITY.md §8 requires telemetry to be opt-in and revocable the
 * moment anything here is ever considered for transmission off-device.
 */
export const TIMING_LOG_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS timing_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  flow        TEXT    NOT NULL,
  step        TEXT    NOT NULL,
  occurred_at INTEGER NOT NULL,
  device_id   TEXT    NOT NULL
);
`;

export const TIMING_LOG_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_timing_log_flow ON timing_log (flow, occurred_at);
`;

export const ALL_SCHEMA_SQL = [
  EVENTS_TABLE_SQL,
  EVENTS_INDEXES_SQL,
  CUSTOMERS_TABLE_SQL,
  BALANCES_TABLE_SQL,
  TIMING_LOG_TABLE_SQL,
  TIMING_LOG_INDEX_SQL,
].join('\n');
