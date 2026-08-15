// migrate.ts — applies server/migrations/*.sql in filename order.
//
// AGENTS.md §6: "SQL migrations are numbered and append-only: 001_events.sql,
// 002_projections.sql. Never edit a migration that has been merged." This
// runner exists so that convention is the whole mechanism — the .sql files
// are the truth, and nothing generates or owns the schema on their behalf.
//
// No migration framework. node-pg-migrate, Prisma and Drizzle all want to own
// the schema and would fight the numbering convention we already have; this
// is ~40 lines against three dependencies. See docs/DECISIONS.md 2026-08-15.
//
// Each file runs inside its own transaction, so a failure leaves the database
// at the last fully-applied migration rather than half-way through one.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from './pool';

const MIGRATIONS_DIR = path.join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'migrations');

const CREATE_MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename   TEXT PRIMARY KEY,
  applied_at BIGINT NOT NULL
)`;

export function listMigrationFiles(dir: string = MIGRATIONS_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // zero-padded numeric prefixes make lexical order the intended order
}

export interface MigrateResult {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
}

/**
 * Arbitrary but fixed: every process that migrates this database must use the
 * same number. Session-scoped, so a crashed migrator releases it when its
 * connection drops rather than wedging every future deploy.
 */
const MIGRATION_LOCK_ID = 4718221;

/**
 * Serialised with a Postgres advisory lock, because concurrent migrators are
 * the normal case, not an edge one: two server instances rolling out at once,
 * and — reproduced directly here — `node --test` forking a process per test
 * file. Without the lock, two callers both find `schema_migrations` absent
 * and both try to create it, and Postgres rejects one on its catalog unique
 * index (23505 on pg_type_typname_nsp_index). The lock also covers the
 * read-then-apply window, so two migrators cannot both decide the same file
 * still needs applying.
 */
export async function migrate(pool: Pool, dir: string = MIGRATIONS_DIR): Promise<MigrateResult> {
  const lockHolder = await pool.connect();
  try {
    await lockHolder.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);

    await lockHolder.query(CREATE_MIGRATIONS_TABLE);

    const { rows } = await lockHolder.query<{ filename: string }>('SELECT filename FROM schema_migrations');
    const already = new Set(rows.map((row) => row.filename));

    const applied: string[] = [];
    const skipped: string[] = [];

    for (const filename of listMigrationFiles(dir)) {
      if (already.has(filename)) {
        skipped.push(filename);
        continue;
      }

      const sql = readFileSync(path.join(dir, filename), 'utf8');
      try {
        // One transaction per file, so a failure leaves the database at the
        // last fully-applied migration rather than half-way through one.
        await lockHolder.query('BEGIN');
        await lockHolder.query(sql);
        await lockHolder.query('INSERT INTO schema_migrations (filename, applied_at) VALUES ($1, $2)', [
          filename,
          Date.now(),
        ]);
        await lockHolder.query('COMMIT');
        applied.push(filename);
      } catch (error) {
        await lockHolder.query('ROLLBACK');
        throw new Error(`migration ${filename} failed: ${String(error)}`, { cause: error });
      }
    }

    return { applied, skipped };
  } finally {
    await lockHolder.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
    lockHolder.release();
  }
}
