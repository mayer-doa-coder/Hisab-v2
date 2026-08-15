// pool.ts — the one place a Postgres connection is created.
//
// `pg` is the single new runtime dependency in this step; the HTTP layer is
// plain node:http and the PIN hash is node:crypto's scrypt, so nothing else
// was added. See docs/DECISIONS.md 2026-08-15.
//
// BIGINT handling: node-postgres returns BIGINT (OID 20) as a *string* by
// default, because a 64-bit integer does not fit in a JS number. Every BIGINT
// in our schema — seq, created_at, received_at, server_seq — is comfortably
// inside Number.MAX_SAFE_INTEGER (epoch ms is ~1.7e12; 2^53 is ~9e15), so the
// parser below is registered once, here, rather than each call site
// remembering to coerce. Money is NOT stored in a BIGINT column on the server
// — it lives inside the JSONB payload — so this does not touch a monetary
// value and AGENTS.md §3.2 is not in play.

import pg from 'pg';

// OID 20 = int8/BIGINT. Registered before any pool is created.
pg.types.setTypeParser(20, (value: string) => Number(value));

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

export interface PoolConfig {
  readonly connectionString: string;
  /** Kept small; this is a single-shop-per-connection workload, not a fan-out. */
  readonly max?: number;
}

export function createPool(config: PoolConfig): Pool {
  return new pg.Pool({
    connectionString: config.connectionString,
    max: config.max ?? 10,
  });
}
