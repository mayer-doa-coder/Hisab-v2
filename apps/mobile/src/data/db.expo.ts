// db.expo.ts — the real, on-device Database implementation. The only file
// in src/data/ that imports expo-sqlite. Not wired into App.tsx or any
// screen in this step (screens are Step 8) — this exists so the interface
// in db.ts is proven implementable by the real backend, not just the test
// one.
//
// No SQLCipher, no encryption — plain expo-sqlite (Step 11's job, per
// docs/SECURITY.md).

import * as SQLite from 'expo-sqlite';
import type { Database, SqlRow, SqlValue } from './db';

export async function openExpoDatabase(name: string): Promise<Database> {
  const db = await SQLite.openDatabaseAsync(name);
  return {
    execAsync: (sql: string) => db.execAsync(sql),
    runAsync: async (sql: string, params: readonly SqlValue[]) => {
      await db.runAsync(sql, params as SqlValue[]);
    },
    getAllAsync: <T extends SqlRow>(sql: string, params: readonly SqlValue[]) =>
      db.getAllAsync<T>(sql, params as SqlValue[]),
  };
}
