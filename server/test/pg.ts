// pg.ts — test-database lifecycle. Shared setup, not a test file itself.
//
// LIFECYCLE PER RUN (docs/DECISIONS.md 2026-08-15):
//   * migrations run ONCE per process, into the database DATABASE_URL names
//   * `resetDatabase()` truncates between test files
//   * the connection is the owner role, which is why it can truncate at all —
//     the running server connects as `hisab_app`, which is granted only
//     SELECT and INSERT on `events` (migration 001). Append-only is enforced
//     by Postgres's permission system, not by a trigger someone has to get
//     right.
//
// CONCURRENCY: the test script passes `--test-concurrency=1`. node:test forks
// a process per FILE, and every file here shares one database — so without
// that flag, one file's `resetDatabase()` truncates tables another file is
// mid-test against. Migrations are separately protected by an advisory lock
// (src/db/migrate.ts), which is needed for real multi-instance deploys
// anyway; the serial flag is specifically about the truncation.
//
// SKIPPING: with no DATABASE_URL these tests skip rather than fail, so B can
// run `npm test` at the repo root without a Postgres install. That is a
// loaded gun — "skip when unconfigured" is exactly how a suite quietly stops
// running in CI — so the CI job asserts a non-zero count of Postgres-backed
// tests actually executed. See .github/workflows/ci.yml.

import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createPool, type Pool } from '../src/db/pool';
import { migrate } from '../src/db/migrate';
import { createServer } from '../src/server';

export const DATABASE_URL = process.env.DATABASE_URL ?? '';
export const HAS_DATABASE = DATABASE_URL.length > 0;

/** node:test's `skip` option takes a reason string; this is that reason, or false to run. */
export const SKIP_WITHOUT_DB: string | false = HAS_DATABASE
  ? false
  : 'DATABASE_URL is not set — see server/test/pg.ts. CI always sets it and asserts these ran.';

// npm runs a workspace script with cwd = the workspace root, so this resolves
// to server/migrations both for a compiled test run (where the .js sits several
// directories deeper under dist/) and for a direct run.
const MIGRATIONS_DIR = path.join(process.cwd(), 'migrations');

let pool: Pool | null = null;
let migrated = false;

export async function getPool(): Promise<Pool> {
  pool ??= createPool({ connectionString: DATABASE_URL, max: 4 });
  if (!migrated) {
    await migrate(pool, MIGRATIONS_DIR);
    migrated = true;
  }
  return pool;
}

/**
 * TRUNCATE, not DELETE — it also resets the `events_server_seq_seq` sequence,
 * so each test file starts from server_seq 1 and cursor assertions are
 * readable. `events` is append-only for the *application*; the owner role
 * used here deliberately retains the capability so tests can reset.
 */
export async function resetDatabase(): Promise<void> {
  const p = await getPool();
  await p.query('TRUNCATE events RESTART IDENTITY CASCADE');
  await p.query('TRUNCATE tokens, shops RESTART IDENTITY CASCADE');
}

export async function closePool(): Promise<void> {
  if (pool !== null) {
    await pool.end();
    pool = null;
    migrated = false;
  }
}

export interface RunningServer {
  readonly baseUrl: string;
  close(): Promise<void>;
}

/** Starts the real server on an ephemeral port. Not a mock — the convergence test drives this. */
export async function startTestServer(): Promise<RunningServer> {
  const p = await getPool();
  const server: Server = createServer({ pool: p });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
