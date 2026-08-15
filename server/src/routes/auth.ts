// auth.ts — register / login / refresh / logout.
//
// HARDENED in this step per docs/SECURITY.md §4:
//   * refresh tokens bound to a device fingerprint, rotated on every use
//   * reuse or cross-fingerprint use revokes the whole token family and
//     writes a security event (server/src/auth/tokens.ts)
//   * rate-limited PIN attempts with exponential lockout, checked before the
//     PIN is even verified (server/src/auth/lockout.ts)
//
// AGENTS.md §8 / SECURITY.md §6: never log PII. Nothing in this file logs a
// phone number or a PIN, in any branch, including failures.

import { z } from 'zod';
import type { Pool } from '../db/pool';
import { hashPin, verifyPin } from '../auth/passwords';
import { checkLockout, clearFailedAttempts, recordFailedAttempt } from '../auth/lockout';
import { issuePair, revokeAllForShop, rotateRefreshToken } from '../auth/tokens';
import { HttpError } from '../http/respond';

/**
 * PIN length: 4-8 digits, matching the client's configurable length (default
 * 6). The client default and this bound are deliberately not the same number
 * — the server accepts a range so the length can be changed on the device
 * without a server deploy.
 *
 * NOTE for Step 12+: no PIN length makes offline brute-force of a
 * PIN-derived SQLCipher key hard (6 digits is a million candidates). The
 * answer there is mixing a Keystore-held secret into the derivation, not a
 * longer PIN. That is a device-side decision and does not change this bound.
 */
const PIN_RE = /^\d{4,8}$/;

/**
 * The device's stable, secure-store-backed id (apps/mobile/src/data/deviceId.ts) —
 * NOT a new concept. Reusing it as the auth fingerprint means no new device
 * identifier is collected; the alternative (a hardware fingerprint — IMEI,
 * Android ID) would be a bigger data-minimisation problem than the one it
 * solves, per SECURITY.md §6.
 */
const CredentialsSchema = z.object({
  // SECURITY.md §4: phone number, not email. Stored as typed; no
  // normalisation is claimed here.
  phone: z.string().min(4).max(32),
  pin: z.string().regex(PIN_RE, 'PIN must be 4-8 digits.'),
  device_fingerprint: z.string().min(1),
});

const RefreshSchema = z.object({
  refresh_token: z.string().min(1),
  device_fingerprint: z.string().min(1),
});

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
  const { phone, pin, device_fingerprint } = parse(CredentialsSchema, body);

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

  const pair = await issuePair(pool, shopId, device_fingerprint, now);
  return toAuthResult(shopId, pair.access, pair.refresh);
}

export async function login(pool: Pool, body: unknown, now: number): Promise<AuthResult> {
  const { phone, pin, device_fingerprint } = parse(CredentialsSchema, body);

  // Checked BEFORE the SELECT/verify below, and identically for a phone that
  // has an account and one that doesn't — see lockout.ts's header on why
  // that symmetry matters.
  const lockout = await checkLockout(pool, phone, now);
  if (lockout.locked) {
    throw new HttpError(
      429,
      'TOO_MANY_ATTEMPTS',
      `Too many attempts. Try again in ${Math.ceil(lockout.retryAfterMs / 1000)}s.`,
      { retry_after_ms: lockout.retryAfterMs },
    );
  }

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
    await recordFailedAttempt(pool, phone, now);
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Phone number or PIN is incorrect.');
  }
  if (!(await verifyPin(pin, shop.pin_hash))) {
    await recordFailedAttempt(pool, phone, now);
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Phone number or PIN is incorrect.');
  }

  await clearFailedAttempts(pool, phone);
  const pair = await issuePair(pool, shop.id, device_fingerprint, now);
  return toAuthResult(shop.id, pair.access, pair.refresh);
}

/**
 * Rotates the refresh token: the caller's old one is consumed and a new one
 * takes its place, in the same family. See tokens.ts's rotateRefreshToken
 * for reuse-detection and fingerprint-mismatch handling — both revoke the
 * family and this function surfaces that as 401, same as any other invalid
 * token, so a client under attack learns nothing more than "log in again."
 */
export async function refresh(pool: Pool, body: unknown, now: number): Promise<AuthResult> {
  const { refresh_token, device_fingerprint } = parse(RefreshSchema, body);

  const result = await rotateRefreshToken(pool, refresh_token, device_fingerprint, now);
  if (result.kind !== 'OK') {
    throw new HttpError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is unknown, expired, or was already used.');
  }

  return toAuthResult(result.shopId, result.access, result.refresh);
}

export async function logout(pool: Pool, shopId: string): Promise<void> {
  await revokeAllForShop(pool, shopId);
}

function toAuthResult(
  shopId: string,
  access: { token: string; expiresAt: number },
  refresh: { token: string; expiresAt: number },
): AuthResult {
  return {
    shop_id: shopId,
    access_token: access.token,
    access_expires_at: access.expiresAt,
    refresh_token: refresh.token,
    refresh_expires_at: refresh.expiresAt,
  };
}
