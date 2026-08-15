// db.ts — the storage boundary. Every other file in src/data/ depends on
// this interface, never on a concrete backend. That is what makes
// eventStore.ts testable without a device: production wires it to
// db.expo.ts (real expo-sqlite); tests wire it to a WASM-backed
// implementation that never touches native code (see test/sqlJsDb.ts and
// docs/DECISIONS.md on why expo-sqlite has no official Node testing story).
//
// Async throughout because the real backend (expo-sqlite) is async — the
// test backend adapts a synchronous engine up to this shape, not the other
// way around, since sync-from-async isn't generally possible.

export type SqlValue = string | number | null;

export interface SqlRow {
  readonly [column: string]: SqlValue;
}

export interface Database {
  /** DDL / pragmas / multi-statement scripts — no bound parameters. */
  execAsync(sql: string): Promise<void>;
  /** INSERT/UPDATE/DELETE with bound parameters. */
  runAsync(sql: string, params: readonly SqlValue[]): Promise<void>;
  /** SELECT with bound parameters. */
  getAllAsync<T extends SqlRow = SqlRow>(sql: string, params: readonly SqlValue[]): Promise<T[]>;
}
