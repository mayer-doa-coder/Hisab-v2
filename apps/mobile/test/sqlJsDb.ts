// sqlJsDb.ts — test-only Database backend (apps/mobile/src/data/db.ts),
// backed by sql.js (SQLite compiled to WASM). Not shipped in the app —
// db.expo.ts is the real backend, imported only outside test/.
//
// Why sql.js and not a native Node SQLite binding: expo-sqlite has no
// official Node/Jest/vitest testing story (checked directly against its own
// docs — see this step's report). better-sqlite3 was tried first and
// failed to install in this environment: no prebuilt binary matched, and
// there is no C++ toolchain here to compile it from source (a real,
// reproduced failure, not a hypothetical one). sql.js needs no native
// compilation at all — same WASM binary on every platform — which is why it
// was the fallback rather than the first choice.

import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import type { Database, SqlRow, SqlValue } from '../src/data/db';

export async function openSqlJsDatabase(): Promise<Database> {
  const SQL = await initSqlJs();
  const raw: SqlJsDatabase = new SQL.Database();

  function runAll<T extends SqlRow>(sql: string, params: readonly SqlValue[]): T[] {
    const stmt = raw.prepare(sql);
    try {
      stmt.bind(params as (string | number | null)[]);
      const rows: T[] = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as unknown as T);
      }
      return rows;
    } finally {
      stmt.free();
    }
  }

  return {
    execAsync: (sql: string) => {
      raw.run(sql);
      return Promise.resolve();
    },
    runAsync: (sql: string, params: readonly SqlValue[]) => {
      raw.run(sql, params as (string | number | null)[]);
      return Promise.resolve();
    },
    getAllAsync: <T extends SqlRow>(sql: string, params: readonly SqlValue[]) =>
      Promise.resolve(runAll<T>(sql, params)),
  };
}
