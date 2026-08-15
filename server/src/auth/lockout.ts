// lockout.ts — SECURITY.md §4: "Rate-limited PIN attempts with exponential
// lockout, enforced locally *and* server-side." This is the server-side half
// and the authoritative one; apps/mobile/src/security/pinSession.ts's local
// cooldown is a courtesy that avoids hammering the network, not a substitute.
//
// Tracked by PHONE, not shop_id, and recorded for every phone that gets
// probed — including ones with no account. login() in routes/auth.ts already
// returns the identical 401 for "unknown phone" and "wrong PIN" so the
// endpoint isn't a phone-number oracle; if lockout only applied to real
// accounts, a LOCKED response would reopen that oracle by implying the
// account exists. Locking every probed phone equally, real or not, keeps it
// closed.

import type { Pool } from '../db/pool';

/** Below this many consecutive failures, no lockout — most wrong-PIN taps are typos, not attacks. */
const LOCKOUT_THRESHOLD = 5;
const BASE_LOCKOUT_MS = 30_000; // 30s at the threshold
const MAX_LOCKOUT_MS = 60 * 60 * 1000; // capped at 1h — this is a shop's only way in, not a public account

/**
 * `failedCount` is attempts AFTER the threshold, so lockout(5) is the base
 * and lockout(6), lockout(7)... double each time: 30s, 1m, 2m, 4m, ... capped.
 * Pure function — same shape as sync/backoff.ts's backoffDelay, deliberately
 * not shared with it: that one computes a CLIENT RETRY delay from an
 * injected `random()`, this one computes a SERVER LOCKOUT duration with no
 * randomness. Different purpose, different inputs; the four-line formula
 * isn't worth a cross-cutting abstraction (AGENTS.md §4.3 is about the
 * balance-check kind of duplication — divergent business logic — not a
 * trivial deterministic formula like this one).
 */
export function lockoutDurationMs(failedCount: number): number {
  if (failedCount < LOCKOUT_THRESHOLD) return 0;
  const exponent = failedCount - LOCKOUT_THRESHOLD;
  return Math.min(BASE_LOCKOUT_MS * 2 ** exponent, MAX_LOCKOUT_MS);
}

export interface LockoutStatus {
  readonly locked: boolean;
  readonly retryAfterMs: number;
}

/** Checked BEFORE touching pin_hash, so a locked phone never pays the scrypt cost either. */
export async function checkLockout(pool: Pool, phone: string, now: number): Promise<LockoutStatus> {
  const { rows } = await pool.query<{ locked_until: number | null }>(
    'SELECT locked_until FROM login_attempts WHERE phone = $1',
    [phone],
  );
  const lockedUntil = rows[0]?.locked_until ?? null;
  if (lockedUntil === null || lockedUntil <= now) {
    return { locked: false, retryAfterMs: 0 };
  }
  return { locked: true, retryAfterMs: lockedUntil - now };
}

/**
 * Increments the failure count and locks if the new count has reached the
 * threshold. Upsert, because most phones probed have no prior row.
 */
export async function recordFailedAttempt(pool: Pool, phone: string, now: number): Promise<void> {
  const { rows } = await pool.query<{ failed_count: number }>(
    `INSERT INTO login_attempts (phone, failed_count, locked_until, updated_at)
     VALUES ($1, 1, NULL, $2)
     ON CONFLICT (phone) DO UPDATE SET
       failed_count = login_attempts.failed_count + 1,
       updated_at = excluded.updated_at
     RETURNING failed_count`,
    [phone, now],
  );
  const failedCount = rows[0]?.failed_count ?? 1;
  const duration = lockoutDurationMs(failedCount);
  if (duration > 0) {
    await pool.query('UPDATE login_attempts SET locked_until = $1 WHERE phone = $2', [now + duration, phone]);
  }
}

/** A successful login clears the slate — the shopkeeper proved who they are. */
export async function clearFailedAttempts(pool: Pool, phone: string): Promise<void> {
  await pool.query('DELETE FROM login_attempts WHERE phone = $1', [phone]);
}
