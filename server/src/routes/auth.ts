// auth.ts — register / login / refresh / logout. docs/SECURITY.md §4.
//
// Functional, NOT hardened. Absent by instruction, and absent honestly rather
// than stubbed (§4: "an endpoint that doesn't verify is an auth bypass.
// Either it works or it isn't merged"):
//
//   * device-fingerprint binding, token-family revocation   — Step 11
//   * refresh-token rotation on use                         — Step 11
//   * server-side exponential lockout                       — Step 11
//
// `register` is not in this step's named list (login / refresh / logout), but
// login is untestable and the PIN screen is unusable without an account to
// log into. Flagged in this step's report rather than added quietly.
//
// AGENTS.md §8 / SECURITY.md §6: never log PII. Nothing in this file logs a
// phone number or a PIN, in any branch, including failures.

import { z } from 'zod';
import type { Pool } from '../db/pool';
import { hashPin, verifyPin } from '../auth/passwords';
import { issueToken, resolveToken, revokeAllForShop } from '../auth/tokens';
import { HttpError } from '../http/respond';

/**
 * PIN length: 4-8 digits, matching the client's configurable length (default
 * 6). The client default and this bound are deliberately not the same number
 * — the server accepts a range so the length can be changed on the device
 * without a server deploy.
 *
 * NOTE for Step 11: no PIN length makes offline brute-force of a
 * PIN-derived SQLCipher key hard (6 digits is a million candidates). The
 * answer there is mixing a Keystore-held secret into the derivation, not a
 * longer PIN. That is a device-side decision and does not change this bound.
 */
const PIN_RE = /^\d{4,8}$/;

const CredentialsSchema = z.object({
  // SECURITY.md §4: phone number, not email. Stored as typed; no
  // normalisation is claimed, and none is done.
  phone: z.string().min(4).max(32),
  pin: z.string().regex(PIN_RE, 'PIN must be 4-8 digits.'),
});

const RefreshSchema = z.object({ refresh_token: z.string().min(1) });

export interface AuthResult {
  readonly shop_id: string;
  readonly access_token: string;
  readonly access_expires_at: number;
  readonly refresh_token: string;
  readonly refresh_expires_at: number;
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new HttpError(400, 'INVALID_BODY', result.error.issues.map((i) => i.message).join('; '));
  }
  return result.data;
}

export async function register(pool: Pool, body: unknown, now: number): Promise<AuthResult> {
  const { phone, pin } = parse(CredentialsSchema, body);

  const existing = await pool.query('SELECT 1 FROM shops WHERE phone = $1', [phone]);
  if (existing.rowCount !== null && existing.rowCount > 0) {
    throw new HttpError(409, 'PHONE_TAKEN', 'An account already exists for this phone number.');
  }

  const shopId = crypto.randomUUID();
  await pool.query('INSERT INTO shops (id, phone, pin_hash, created_at) VALUES ($1, $2, $3, $4)', [
    shopId,
    phone,
    await hashPin(pin),
    now,
  ]);

  return issuePair(pool, shopId, now);
}

export async function login(pool: Pool, body: unknown, now: number): Promise<AuthResult> {
  const { phone, pin } = parse(CredentialsSchema, body);

  const { rows } = await pool.query<{ id: string; pin_hash: string }>(
    'SELECT id, pin_hash FROM shops WHERE phone = $1',
    [phone],
  );
  const shop = rows[0];

  // One indistinguishable failure for "no such phone" and "wrong PIN", so the
  // endpoint is not a phone-number oracle. The unknown-phone branch still runs
  // a hash so the two paths take comparable time.
  if (shop === undefined) {
    await hashPin(pin);
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Phone number or PIN is incorrect.');
  }
  if (!(await verifyPin(pin, shop.pin_hash))) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Phone number or PIN is incorrect.');
  }

  return issuePair(pool, shop.id, now);
}

/**
 * Mints a new access token. Deliberately does NOT rotate the refresh token —
 * rotation is Step 11, and this step's instructions say not to start it. The
 * caller keeps the refresh token it already has.
 */
export async function refresh(pool: Pool, body: unknown, now: number): Promise<Omit<AuthResult, 'refresh_token' | 'refresh_expires_at'>> {
  const { refresh_token } = parse(RefreshSchema, body);

  const shopId = await resolveToken(pool, refresh_token, 'REFRESH', now);
  if (shopId === null) {
    throw new HttpError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is unknown or expired.');
  }

  const access = await issueToken(pool, shopId, 'ACCESS', now);
  return { shop_id: shopId, access_token: access.token, access_expires_at: access.expiresAt };
}

export async function logout(pool: Pool, shopId: string): Promise<void> {
  await revokeAllForShop(pool, shopId);
}

async function issuePair(pool: Pool, shopId: string, now: number): Promise<AuthResult> {
  const access = await issueToken(pool, shopId, 'ACCESS', now);
  const refreshToken = await issueToken(pool, shopId, 'REFRESH', now);
  return {
    shop_id: shopId,
    access_token: access.token,
    access_expires_at: access.expiresAt,
    refresh_token: refreshToken.token,
    refresh_expires_at: refreshToken.expiresAt,
  };
}
