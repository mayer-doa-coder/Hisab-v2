// tokens.ts — opaque bearer tokens, WITH device-fingerprint binding, rotation
// on every use, and family revocation. SECURITY.md §4, hardened in this step.
//
// Opaque random tokens rather than JWTs: a JWT would need a signing library
// or hand-rolled JWS, and buys nothing here because the server has a
// database on every request anyway. Revocation is a DELETE/mark instead of a
// blocklist.
//
// FAMILY MODEL: every refresh token minted from one login shares a
// `family_id`. Redeeming a refresh token issues a new refresh token in the
// same family and marks the old one `rotated_at`. A refresh token can only
// ever be redeemed once. Two conditions revoke the WHOLE family and write a
// security event:
//   - REFRESH_REUSE: the presented token is already `rotated_at` — a
//     legitimate client never has the old token anymore once it rotated, so
//     someone else has a copy.
//   - FINGERPRINT_MISMATCH: the presented device_fingerprint does not match
//     the one the token was issued to.

import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from '../db/pool';

export type TokenKind = 'ACCESS' | 'REFRESH';

/** Short, because rotation now exists — a leaked access token expires quickly, and refresh rotates it away regardless. */
export const ACCESS_TTL_MS = 15 * 60 * 1000;
/** Long enough that a shop offline for a week can still refresh without re-entering the PIN. */
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface IssuedToken {
  readonly token: string;
  readonly expiresAt: number;
}

export interface IssuedPair {
  readonly access: IssuedToken;
  readonly refresh: IssuedToken;
  readonly familyId: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Access tokens carry no fingerprint — SECURITY.md §4 only names refresh tokens for binding. */
export async function issueAccessToken(pool: Pool, shopId: string, now: number): Promise<IssuedToken> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = now + ACCESS_TTL_MS;
  await pool.query(
    `INSERT INTO tokens (token_hash, shop_id, kind, expires_at, created_at)
     VALUES ($1, $2, 'ACCESS', $3, $4)`,
    [hashToken(token), shopId, expiresAt, now],
  );
  return { token, expiresAt };
}

/** Starts a new family: login and register both call this, never rotateRefreshToken. */
export async function issuePair(
  pool: Pool,
  shopId: string,
  deviceFingerprint: string,
  now: number,
): Promise<IssuedPair> {
  const familyId = crypto.randomUUID();
  const access = await issueAccessToken(pool, shopId, now);
  const refresh = await issueFamilyMember(pool, shopId, familyId, deviceFingerprint, now);
  return { access, refresh, familyId };
}

async function issueFamilyMember(
  pool: Pool,
  shopId: string,
  familyId: string,
  deviceFingerprint: string,
  now: number,
): Promise<IssuedToken> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = now + REFRESH_TTL_MS;
  await pool.query(
    `INSERT INTO tokens (token_hash, shop_id, kind, expires_at, created_at, family_id, device_fingerprint)
     VALUES ($1, $2, 'REFRESH', $3, $4, $5, $6)`,
    [hashToken(token), shopId, expiresAt, now, familyId, deviceFingerprint],
  );
  return { token, expiresAt };
}

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

export type RotateResult =
  | { readonly kind: 'OK'; readonly shopId: string; readonly access: IssuedToken; readonly refresh: IssuedToken }
  | { readonly kind: 'INVALID' }
  | { readonly kind: 'REUSE_DETECTED' }
  | { readonly kind: 'FINGERPRINT_MISMATCH' };

interface RefreshRow {
  readonly shop_id: string;
  readonly family_id: string | null;
  readonly device_fingerprint: string | null;
  readonly rotated_at: number | null;
  readonly expires_at: number;
}

/**
 * The one function that implements SECURITY.md §4's rotation-and-revocation
 * requirement in full. Every branch either issues a fresh pair or revokes the
 * family — there is no third outcome, matching "an endpoint that doesn't
 * verify is an auth bypass" applied to reuse detection specifically: a
 * refresh path that silently ignored reuse would be exactly that.
 */
export async function rotateRefreshToken(
  pool: Pool,
  refreshToken: string,
  deviceFingerprint: string,
  now: number,
): Promise<RotateResult> {
  const tokenHash = hashToken(refreshToken);
  const { rows } = await pool.query<RefreshRow>(
    `SELECT shop_id, family_id, device_fingerprint, rotated_at, expires_at
       FROM tokens WHERE token_hash = $1 AND kind = 'REFRESH'`,
    [tokenHash],
  );
  const row = rows[0];

  if (row === undefined || row.expires_at <= now || row.family_id === null) {
    return { kind: 'INVALID' };
  }

  if (row.rotated_at !== null) {
    // Someone presented a token that was already redeemed. The legitimate
    // client has the NEW one; this copy came from somewhere else.
    await revokeFamily(pool, row.shop_id, row.family_id, 'REFRESH_REUSE', now);
    return { kind: 'REUSE_DETECTED' };
  }

  if (row.device_fingerprint !== deviceFingerprint) {
    await revokeFamily(pool, row.shop_id, row.family_id, 'FINGERPRINT_MISMATCH', now);
    return { kind: 'FINGERPRINT_MISMATCH' };
  }

  // Mark this token spent, then issue its successor in the same family. Not
  // wrapped in an explicit transaction: a crash between these two statements
  // leaves the old token rotated with no successor, which fails CLOSED (the
  // shopkeeper re-logs-in with their PIN) rather than open.
  await pool.query('UPDATE tokens SET rotated_at = $1 WHERE token_hash = $2', [now, tokenHash]);

  const access = await issueAccessToken(pool, row.shop_id, now);
  const refresh = await issueFamilyMember(pool, row.shop_id, row.family_id, deviceFingerprint, now);
  return { kind: 'OK', shopId: row.shop_id, access, refresh };
}

async function revokeFamily(
  pool: Pool,
  shopId: string,
  familyId: string,
  reason: 'REFRESH_REUSE' | 'FINGERPRINT_MISMATCH',
  now: number,
): Promise<void> {
  const { rowCount } = await pool.query('DELETE FROM tokens WHERE family_id = $1', [familyId]);
  await pool.query(
    'INSERT INTO security_events (id, shop_id, kind, detail, created_at) VALUES ($1, $2, $3, $4, $5)',
    [crypto.randomUUID(), shopId, reason, `family_id=${familyId} tokens_revoked=${rowCount ?? 0}`, now],
  );
}

/**
 * Logout. Deletes every token for the shop, not just the one presented —
 * "log me out" on a shared counter phone should mean the whole session.
 */
export async function revokeAllForShop(pool: Pool, shopId: string): Promise<void> {
  await pool.query('DELETE FROM tokens WHERE shop_id = $1', [shopId]);
}

export async function deleteExpired(pool: Pool, now: number): Promise<void> {
  await pool.query('DELETE FROM tokens WHERE expires_at <= $1', [now]);
}
