// api.ts — the HTTP client for server/. Nothing else in the app talks to the
// network.
//
// EXPO_PUBLIC_API_BASE_URL is the only permitted public env var (AGENTS.md
// §4.4, SECURITY.md §3), and it is passed in as config rather than read here
// so this module has no ambient dependency on the bundler's env inlining.
//
// AGENTS.md §8 / SECURITY.md §6: no PII in any error path. Failures carry a
// status and a server error code, never a request body and never a name,
// phone number, or amount.

import type { RemoteEvent } from '../data/eventStore';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    /** Only ever machine-readable fields the server explicitly opted to expose — see HttpError.details server-side. */
    readonly retryAfterMs: number | null = null,
  ) {
    super(`API ${status} ${code}`);
    this.name = 'ApiError';
  }

  /** 5xx and 429 are worth retrying; a 400 or 401 will fail identically forever. */
  get retryable(): boolean {
    return this.status >= 500 || this.status === 429;
  }
}

export interface AuthTokens {
  readonly shop_id: string;
  readonly access_token: string;
  readonly access_expires_at: number;
  readonly refresh_token: string;
  readonly refresh_expires_at: number;
}

export interface PushResponse {
  readonly accepted: readonly string[];
  readonly duplicates: readonly string[];
  readonly rejected: readonly { readonly id: string | null; readonly reason: string; readonly detail: string }[];
  readonly server_seq: number;
}

/**
 * A pulled event carries the server's own cursor value alongside the
 * envelope. `server_seq` is server-assigned and deliberately NOT part of
 * `RemoteEvent` — the event store must never persist it, because it is the
 * server's pagination bookkeeping, not a property of the event. The cursor
 * lives in the `sync_cursor` table instead.
 */
export interface PulledEvent extends RemoteEvent {
  readonly server_seq: number;
}

export interface PullResponse {
  readonly events: readonly PulledEvent[];
  readonly server_seq: number;
}

export interface ApiConfig {
  readonly baseUrl: string;
  /** Injected so tests can drive it without a global; production passes globalThis.fetch. */
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export class Api {
  private readonly baseUrl: string;
  private readonly doFetch: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(config: ApiConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.doFetch = config.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async register(phone: string, pin: string, deviceFingerprint: string): Promise<AuthTokens> {
    return this.request<AuthTokens>('POST', '/v1/auth/register', {
      body: { phone, pin, device_fingerprint: deviceFingerprint },
    });
  }

  async login(phone: string, pin: string, deviceFingerprint: string): Promise<AuthTokens> {
    return this.request<AuthTokens>('POST', '/v1/auth/login', {
      body: { phone, pin, device_fingerprint: deviceFingerprint },
    });
  }

  /**
   * The server ROTATES on every call (docs/SECURITY.md §4) — the response
   * carries a NEW refresh_token, and the one passed in is now dead. The
   * caller MUST persist the full response, not just the access token, or the
   * next refresh will fail with INVALID_REFRESH_TOKEN.
   */
  async refresh(refreshToken: string, deviceFingerprint: string): Promise<AuthTokens> {
    return this.request<AuthTokens>('POST', '/v1/auth/refresh', {
      body: { refresh_token: refreshToken, device_fingerprint: deviceFingerprint },
    });
  }

  async logout(accessToken: string): Promise<void> {
    await this.request('POST', '/v1/auth/logout', { token: accessToken });
  }

  async push(accessToken: string, events: readonly unknown[]): Promise<PushResponse> {
    return this.request<PushResponse>('POST', '/v1/events', { token: accessToken, body: { events } });
  }

  async pull(accessToken: string, since: number, limit?: number): Promise<PullResponse> {
    const query = new URLSearchParams({ since: String(since) });
    if (limit !== undefined) query.set('limit', String(limit));
    return this.request<PullResponse>('GET', `/v1/events?${query.toString()}`, { token: accessToken });
  }

  async health(): Promise<boolean> {
    try {
      await this.request('GET', '/health', {});
      return true;
    } catch {
      return false;
    }
  }

  private async request<T>(
    method: string,
    path: string,
    options: { token?: string; body?: unknown },
  ): Promise<T> {
    // AbortController rather than Promise.race: a race leaves the underlying
    // request running and its socket open, which on a metered connection is
    // exactly what a timeout is supposed to stop.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {};
      if (options.token !== undefined) headers.Authorization = `Bearer ${options.token}`;
      if (options.body !== undefined) headers['Content-Type'] = 'application/json';

      const response = await this.doFetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        signal: controller.signal,
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      });

      if (!response.ok) {
        const { code, retryAfterMs } = await readErrorBody(response);
        throw new ApiError(response.status, code, retryAfterMs);
      }

      const text = await response.text();
      return (text.length > 0 ? JSON.parse(text) : undefined) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

async function readErrorBody(response: Response): Promise<{ code: string; retryAfterMs: number | null }> {
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null) {
      const record = body as Record<string, unknown>;
      const code = typeof record.error === 'string' ? record.error : 'UNKNOWN';
      const retryAfterMs = typeof record.retry_after_ms === 'number' ? record.retry_after_ms : null;
      return { code, retryAfterMs };
    }
  } catch {
    // Body was not JSON. The status alone is enough; nothing from an
    // unparseable body gets surfaced.
  }
  return { code: 'UNKNOWN', retryAfterMs: null };
}
