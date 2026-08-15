// tokens.ts — opaque bearer tokens. Functional, NOT hardened.
//
// docs/SECURITY.md §4 requires refresh tokens "bound to a device fingerprint
// and rotated on every use", with family revocation on reuse from a different
// fingerprint. NONE of that is here — it is Step 11, and this step's
// instructions say so explicitly. What IS here is real: tokens are
// cryptographically random, only their SHA-256 is stored, they expire, and
// logout deletes them. There is no stubbed code path that accepts an
// unverified token (SECURITY.md §4: "an endpoint that doesn't verify is an
// auth bypass").
//
// Opaque random tokens rather than JWTs: a JWT would need a signing library or
// hand-rolled JWS, and buys nothing here because the server has a database on
// every request anyway. Revocation is a DELETE instead of a blocklist.

import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from '../db/pool';

export type TokenKind = 'ACCESS' | 'REFRESH';

/** Short, because there is no rotation yet — a leaked access token expires quickly on its own. */
export const ACCESS_TTL_MS = 15 * 60 * 1000;
/** Long enough that a shop offline for a week can still refresh without re-entering the PIN. */
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface IssuedToken {
  readonly token: string;
  readonly expiresAt: number;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function issueToken(
  pool: Pool,
  shopId: string,
  kind: TokenKind,
  now: number,
): Promise<IssuedToken> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = now + (kind === 'ACCESS' ? ACCESS_TTL_MS : REFRESH_TTL_MS);

  await pool.query(
    'INSERT INTO tokens (token_hash, shop_id, kind, expires_at, created_at) VALUES ($1, $2, $3, $4, $5)',
    [hashToken(token), shopId, kind, expiresAt, now],
  );

  return { token, expiresAt };
}

/** Returns the shop id a live token of the expected kind belongs to, or null. */
export async function resolveToken(
  pool: Pool,
  token: string,
  kind: TokenKind,
  now: number,
): Promise<string | null> {
  const { rows } = await pool.query<{ shop_id: string }>(
    'SELECT shop_id FROM tokens WHERE token_hash = $1 AND kind = $2 AND expires_at > $3',
    [hashToken(token), kind, now],
  );
  return rows[0]?.shop_id ?? null;
}

/**
 * Logout. Deletes every token for the shop, not just the one presented —
 * "log me out" on a shared counter phone should mean the whole session, and
 * without rotation there is no token family to reason about more finely.
 */
export async function revokeAllForShop(pool: Pool, shopId: string): Promise<void> {
  await pool.query('DELETE FROM tokens WHERE shop_id = $1', [shopId]);
}

export async function deleteExpired(pool: Pool, now: number): Promise<void> {
  await pool.query('DELETE FROM tokens WHERE expires_at <= $1', [now]);
}
