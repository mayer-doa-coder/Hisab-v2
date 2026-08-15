// syncEngine.ts — push unsynced, pull remote, merge. BUILD_PLAN.md Phase 3.
//
// AGENTS.md §3.5: sync never blocks the counter. Nothing here is called from
// a core flow, nothing here shows a spinner, and a total failure to sync is
// not an error state the shopkeeper is told about — the local write already
// happened and is durable. UI_SPEC.md: "No offline banner. Offline is the
// normal state, not an error."
//
// Order matters: PUSH BEFORE PULL. Pushing first means this device's own
// events come back in the pull already marked synced, and a device that is
// about to be reset or reinstalled has surrendered its unique local state
// before it takes on anything new.

import type { AnyEvent } from '@hisab/domain';
import type { EventStore } from '../data/eventStore';
import { Api, ApiError, type AuthTokens } from './api';
import { backoffDelay, shouldRetry, DEFAULT_BACKOFF, type BackoffPolicy } from './backoff';
import { CircuitBreaker } from './circuitBreaker';

/** Matches the server's MAX_BATCH_EVENTS. Larger batches are split, never dropped. */
const PUSH_BATCH_SIZE = 500;
const PULL_PAGE_SIZE = 500;

export interface SyncOutcome {
  readonly pushed: number;
  readonly pulled: number;
  readonly rejected: number;
  readonly skipped: boolean;
  readonly error: string | null;
}

export interface TokenStore {
  get(): Promise<AuthTokens | null>;
  set(tokens: AuthTokens): Promise<void>;
  clear(): Promise<void>;
}

export interface SyncEngineConfig {
  readonly api: Api;
  readonly store: EventStore;
  readonly tokens: TokenStore;
  /**
   * The device's stable id (apps/mobile/src/data/deviceId.ts), sent as the
   * refresh token's bound fingerprint (docs/SECURITY.md §4). Required, not
   * optional: a refresh call with no fingerprint would either fail the
   * server's schema or bind to an empty string, neither of which is a real
   * device identity.
   */
  readonly deviceFingerprint: string;
  readonly breaker?: CircuitBreaker;
  readonly backoff?: BackoffPolicy;
  readonly now?: () => number;
  readonly random?: () => number;
  /** Injected so tests do not actually wait out a backoff. */
  readonly sleep?: (ms: number) => Promise<void>;
}

export class SyncEngine {
  private readonly api: Api;
  private readonly store: EventStore;
  private readonly tokens: TokenStore;
  private readonly deviceFingerprint: string;
  private readonly breaker: CircuitBreaker;
  private readonly backoff: BackoffPolicy;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private inFlight: Promise<SyncOutcome> | null = null;

  constructor(config: SyncEngineConfig) {
    this.api = config.api;
    this.store = config.store;
    this.tokens = config.tokens;
    this.deviceFingerprint = config.deviceFingerprint;
    this.breaker = config.breaker ?? new CircuitBreaker();
    this.backoff = config.backoff ?? DEFAULT_BACKOFF;
    this.now = config.now ?? Date.now;
    this.random = config.random ?? Math.random;
    this.sleep = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * One full pass. Concurrent calls share the in-flight pass rather than
   * running twice — the background task and a foreground trigger can easily
   * fire together, and two passes would push the same batch twice. Harmless
   * (the server is idempotent), but wasteful on a metered connection.
   */
  async syncOnce(): Promise<SyncOutcome> {
    this.inFlight ??= this.runPass().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async runPass(): Promise<SyncOutcome> {
    if (!this.breaker.canAttempt()) {
      return { pushed: 0, pulled: 0, rejected: 0, skipped: true, error: null };
    }

    const tokens = await this.tokens.get();
    if (tokens === null) {
      // Not logged in. Not a failure and not a breaker event — there is
      // simply nowhere to sync to yet.
      return { pushed: 0, pulled: 0, rejected: 0, skipped: true, error: null };
    }

    try {
      const accessToken = await this.validAccessToken(tokens);
      const pushed = await this.push(accessToken);
      const pulled = await this.pull(accessToken);
      this.breaker.recordSuccess();
      return { pushed: pushed.pushed, pulled, rejected: pushed.rejected, skipped: false, error: null };
    } catch (error) {
      this.breaker.recordFailure();
      if (error instanceof ApiError && !error.retryable) {
        // A 401 means the token is dead; clearing it sends the user back to
        // the PIN screen on next launch rather than retrying forever.
        if (error.status === 401) await this.tokens.clear();
      }
      return {
        pushed: 0,
        pulled: 0,
        rejected: 0,
        skipped: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Retries a single operation with full-jitter backoff, honouring the breaker. */
  async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        const result = await operation();
        this.breaker.recordSuccess();
        return result;
      } catch (error) {
        const retryable = !(error instanceof ApiError) || error.retryable;
        this.breaker.recordFailure();
        if (!retryable || !shouldRetry(attempt, this.backoff) || !this.breaker.canAttempt()) {
          throw error;
        }
        await this.sleep(backoffDelay(attempt, this.backoff, this.random));
        attempt += 1;
      }
    }
  }

  private async validAccessToken(tokens: AuthTokens): Promise<string> {
    // 30s of slack, so a token that expires mid-request is refreshed first.
    if (tokens.access_expires_at > this.now() + 30_000) return tokens.access_token;

    // The server ROTATES on every refresh (docs/SECURITY.md §4) — the
    // response is a whole new pair, and `tokens.refresh_token` above is now
    // dead. The full response must be persisted, not merged field-by-field,
    // or the next refresh presents an already-rotated token and the server
    // treats that as theft (tokens.ts's REUSE_DETECTED path), revoking the
    // family and forcing a full re-login.
    const refreshed = await this.api.refresh(tokens.refresh_token, this.deviceFingerprint);
    await this.tokens.set(refreshed);
    return refreshed.access_token;
  }

  private async push(accessToken: string): Promise<{ pushed: number; rejected: number }> {
    const pending = await this.store.unsynced();
    if (pending.length === 0) return { pushed: 0, rejected: 0 };

    let pushed = 0;
    let rejected = 0;

    for (let i = 0; i < pending.length; i += PUSH_BATCH_SIZE) {
      const batch = pending.slice(i, i + PUSH_BATCH_SIZE);
      const response = await this.withRetry(() => this.api.push(accessToken, batch.map(toWire)));

      // `duplicates` are as settled as `accepted` — the server holds them, so
      // this device must stop resending them. Treating a duplicate as a
      // failure is how a client ends up pushing the same batch forever.
      const settled = [...response.accepted, ...response.duplicates];
      await this.store.markPushed(settled, this.now());
      pushed += settled.length;
      rejected += response.rejected.length;

      if (response.rejected.length > 0) {
        // Rejections are a bug on one side or the other, not a normal
        // outcome. Log the ids and reasons only — never the payload
        // (AGENTS.md §8).
        console.warn(
          '[sync] server rejected events:',
          response.rejected.map((r) => `${r.id ?? 'unknown'}:${r.reason}`).join(', '),
        );
      }
    }

    return { pushed, rejected };
  }

  private async pull(accessToken: string): Promise<number> {
    let cursor = await this.store.getCursor();
    let total = 0;

    for (;;) {
      const page = await this.withRetry(() => this.api.pull(accessToken, cursor, PULL_PAGE_SIZE));
      if (page.events.length === 0) break;

      await this.store.merge(page.events);
      total += page.events.length;

      // Advance only to what actually arrived — never to the server's
      // reported max. See docs/DECISIONS.md 2026-08-15 on the
      // uncommitted-BIGSERIAL gap.
      cursor = page.server_seq;
      await this.store.setCursor(cursor);

      if (page.events.length < PULL_PAGE_SIZE) break;
    }

    return total;
  }
}

/** The wire shape: the envelope as EVENTS.md §1 defines it, minus device-local sync state. */
function toWire(event: AnyEvent): Record<string, unknown> {
  return {
    id: event.id,
    device_id: event.device_id,
    seq: event.seq,
    hlc: event.hlc,
    shop_id: event.shop_id,
    type: event.type,
    payload: event.payload,
    created_at: event.created_at,
  };
}
