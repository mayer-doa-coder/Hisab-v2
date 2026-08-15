// pinSession.ts — what "verify this PIN" actually means, kept out of the
// screen so the screen stays a keypad with a callback.
//
// A DESIGN POINT WORTH NAMING, raised in Step 10's report and not yet
// settled in docs/SECURITY.md §4. §4 says "PIN hashed server-side", which
// read literally makes unlocking the app a network round-trip — forbidden by
// AGENTS.md §3.5 ("No network call in any core flow, ever") and wrong for a
// shop whose internet is down, which must not lock the shopkeeper out of
// their own ledger.
//
// Two different things are collapsed in that one line:
//
//   1. UNLOCK — offline, authoritative, device-side. From the SQLCipher step
//      this needs no stored hash at all: a wrong PIN yields a key that does
//      not decrypt the database, which is strictly better than comparing
//      hashes because there is nothing to compare against or steal.
//   2. AUTHENTICATION TO THE SYNC ENDPOINT — online, server-side hash, gates
//      token issuance. This is what server/src/auth/ implements.
//
// Until the database is actually encrypted, (1) has nothing to verify
// against locally, so this step still implements (2) only: the PIN is
// checked by logging in. THE PIN SCREEN CURRENTLY REQUIRES CONNECTIVITY ON
// FIRST UNLOCK — a real limitation, stated here rather than hidden.

import type { Api, AuthTokens } from '../sync/api';
import { ApiError } from '../sync/api';
import type { TokenStore } from '../sync/syncEngine';

export type PinResult =
  | { readonly kind: 'OK'; readonly tokens: AuthTokens }
  | { readonly kind: 'INCORRECT' }
  | { readonly kind: 'LOCKED_OUT'; readonly retryAfterMs: number }
  | { readonly kind: 'UNAVAILABLE' };

/**
 * PIN length is configurable rather than fixed, because the right answer is
 * genuinely unsettled and belongs to the SQLCipher step:
 *
 * Against ONLINE guessing, length barely matters — SECURITY.md §4's
 * exponential lockout is the real defence, which argues for 4 digits and one
 * less tap on a high-frequency action. Against OFFLINE brute force of a
 * PIN-derived SQLCipher key, lockout does nothing and 6 digits is still only
 * a million candidates — weak at any KDF cost a 2 GB phone can afford. The
 * fix there is mixing a Keystore-held secret into the derivation, not a
 * longer PIN.
 *
 * Default 6 until that step settles it.
 */
export const DEFAULT_PIN_LENGTH = 6;

/**
 * The LOCAL half of SECURITY.md §4's "rate-limited PIN attempts... enforced
 * locally *and* server-side." NOT the authoritative lockout — the server
 * (server/src/auth/lockout.ts) is authoritative and this local one exists
 * only so a bystander thumbing through candidates while the shopkeeper's
 * back is turned gets stopped on-device, without waiting for a round trip.
 * Deliberately mirrors the server's shape (same threshold, same doubling)
 * but the two are independent implementations of the same small formula —
 * not a shared module, because one runs in node:crypto-having Node and the
 * other in React Native with no node:crypto, and the formula itself is a
 * few lines of arithmetic, not business logic worth cross-platform sharing
 * (AGENTS.md §4.3 is about divergent business rules, not a duplicated
 * constant-and-a-multiply).
 */
export const LOCKOUT_THRESHOLD = 5;
const BASE_LOCKOUT_MS = 30_000;
const MAX_LOCKOUT_MS = 60 * 60 * 1000;

export function localLockoutDurationMs(failedCount: number): number {
  if (failedCount < LOCKOUT_THRESHOLD) return 0;
  const exponent = failedCount - LOCKOUT_THRESHOLD;
  return Math.min(BASE_LOCKOUT_MS * 2 ** exponent, MAX_LOCKOUT_MS);
}

export interface PinSessionConfig {
  readonly api: Api;
  readonly tokens: TokenStore;
  readonly phone: string;
  /** apps/mobile/src/data/deviceId.ts's stable id — sent as the refresh token's bound fingerprint. */
  readonly deviceFingerprint: string;
  readonly now?: () => number;
}

export class PinSession {
  private failedCount = 0;
  private cooldownUntil = 0;
  private readonly now: () => number;

  constructor(private readonly config: PinSessionConfig) {
    this.now = config.now ?? Date.now;
  }

  remainingCooldownMs(): number {
    return Math.max(0, this.cooldownUntil - this.now());
  }

  attemptsRemaining(): number {
    return Math.max(0, LOCKOUT_THRESHOLD - this.failedCount);
  }

  async submit(pin: string): Promise<PinResult> {
    const remaining = this.remainingCooldownMs();
    if (remaining > 0) return { kind: 'LOCKED_OUT', retryAfterMs: remaining };

    try {
      const tokens = await this.config.api.login(this.config.phone, pin, this.config.deviceFingerprint);
      await this.config.tokens.set(tokens);
      this.failedCount = 0;
      this.cooldownUntil = 0;
      return { kind: 'OK', tokens };
    } catch (error) {
      // The server enforces its own lockout (429 TOO_MANY_ATTEMPTS) and is
      // authoritative — the response carries retry_after_ms (HttpError's
      // `details`, server/src/http/respond.ts), and the local cooldown is
      // set from that exact value rather than recomputed, so the two never
      // disagree about how long is left. Falls back to the local formula
      // only if the server ever omits the field, which would itself be a
      // bug worth surfacing rather than a silent guess.
      if (error instanceof ApiError && error.status === 429) {
        const durationMs = error.retryAfterMs ?? localLockoutDurationMs(LOCKOUT_THRESHOLD);
        this.cooldownUntil = this.now() + durationMs;
        return { kind: 'LOCKED_OUT', retryAfterMs: durationMs };
      }
      if (error instanceof ApiError && error.status === 401) {
        this.failedCount += 1;
        const duration = localLockoutDurationMs(this.failedCount);
        if (duration > 0) {
          this.cooldownUntil = this.now() + duration;
          return { kind: 'LOCKED_OUT', retryAfterMs: duration };
        }
        return { kind: 'INCORRECT' };
      }
      // Network down, server unreachable, 5xx. NOT counted as a failed
      // attempt — the shopkeeper typed nothing wrong, and counting it would
      // lock them out for having bad signal.
      return { kind: 'UNAVAILABLE' };
    }
  }

  /** Minimal PIN *setup*: registers the shop. No strength meter, no recovery flow. */
  async setPin(pin: string): Promise<PinResult> {
    try {
      const tokens = await this.config.api.register(this.config.phone, pin, this.config.deviceFingerprint);
      await this.config.tokens.set(tokens);
      return { kind: 'OK', tokens };
    } catch {
      return { kind: 'UNAVAILABLE' };
    }
  }
}
