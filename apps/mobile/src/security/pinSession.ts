// pinSession.ts — what "verify this PIN" actually means, kept out of the
// screen so the screen stays a keypad with a callback.
//
// A DESIGN POINT WORTH NAMING, raised in this step's report and not yet
// settled in docs/SECURITY.md §4. §4 says "PIN hashed server-side", which
// read literally makes unlocking the app a network round-trip — forbidden by
// AGENTS.md §3.5 ("No network call in any core flow, ever") and wrong for a
// shop whose internet is down, which must not lock the shopkeeper out of
// their own ledger.
//
// Two different things are collapsed in that one line:
//
//   1. UNLOCK — offline, authoritative, device-side. From Step 11 this needs
//      no stored hash at all: a wrong PIN yields a key that does not decrypt
//      the SQLCipher database, which is strictly better than comparing
//      hashes because there is nothing to compare against or steal.
//   2. AUTHENTICATION TO THE SYNC ENDPOINT — online, server-side hash, gates
//      token issuance. This is what server/src/auth/ implements.
//
// Until Step 11 there is no encrypted database, so (1) has nothing to verify
// against locally and this step implements (2) only: the PIN is checked by
// logging in. That means THE PIN SCREEN CURRENTLY REQUIRES CONNECTIVITY ON
// FIRST UNLOCK, which is a real limitation of this step and disappears in
// Step 11 when the database key becomes the check. Stated here rather than
// hidden behind a working-looking screen.

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
 * genuinely unsettled and belongs to Step 11:
 *
 * Against ONLINE guessing, length barely matters — SECURITY.md §4's
 * exponential lockout is the real defence, which argues for 4 digits and one
 * less tap on a high-frequency action. Against OFFLINE brute force of a
 * PIN-derived SQLCipher key (Step 11), lockout does nothing and 6 digits is
 * still only a million candidates — weak at any KDF cost a 2 GB phone can
 * afford. The fix there is mixing a Keystore-held secret into the derivation
 * so there is nothing offline to brute-force, NOT a longer PIN.
 *
 * Default 6 until Step 11 settles it.
 */
export const DEFAULT_PIN_LENGTH = 6;

/**
 * The LOCAL half of SECURITY.md §4's "rate-limited PIN attempts... enforced
 * locally *and* server-side". The server-side half is Step 11 and is not
 * built. Deliberately a short, flat cooldown rather than exponential lockout,
 * which §4 assigns to Step 11 — this only stops a bystander thumbing through
 * candidates while the shopkeeper's back is turned.
 */
export const MAX_ATTEMPTS_BEFORE_COOLDOWN = 5;
export const COOLDOWN_MS = 30_000;

export interface PinSessionConfig {
  readonly api: Api;
  readonly tokens: TokenStore;
  readonly phone: string;
  readonly now?: () => number;
}

export class PinSession {
  private failures = 0;
  private cooldownUntil = 0;
  private readonly now: () => number;

  constructor(private readonly config: PinSessionConfig) {
    this.now = config.now ?? Date.now;
  }

  remainingCooldownMs(): number {
    return Math.max(0, this.cooldownUntil - this.now());
  }

  attemptsRemaining(): number {
    return Math.max(0, MAX_ATTEMPTS_BEFORE_COOLDOWN - this.failures);
  }

  async submit(pin: string): Promise<PinResult> {
    const remaining = this.remainingCooldownMs();
    if (remaining > 0) return { kind: 'LOCKED_OUT', retryAfterMs: remaining };

    try {
      const tokens = await this.config.api.login(this.config.phone, pin);
      await this.config.tokens.set(tokens);
      this.failures = 0;
      return { kind: 'OK', tokens };
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        this.failures += 1;
        if (this.failures >= MAX_ATTEMPTS_BEFORE_COOLDOWN) {
          this.cooldownUntil = this.now() + COOLDOWN_MS;
          this.failures = 0;
          return { kind: 'LOCKED_OUT', retryAfterMs: COOLDOWN_MS };
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
      const tokens = await this.config.api.register(this.config.phone, pin);
      await this.config.tokens.set(tokens);
      return { kind: 'OK', tokens };
    } catch {
      return { kind: 'UNAVAILABLE' };
    }
  }
}
