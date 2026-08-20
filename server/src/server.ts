// server.ts — routing. Plain node:http; no framework (docs/DECISIONS.md
// 2026-08-15). Exported as a factory so tests can start it on an ephemeral
// port against a test database, and so nothing is created as a module-level
// side effect.

import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Pool } from './db/pool';
import {
  applyCors,
  bearerToken,
  HttpError,
  readJsonBody,
  sendError,
  sendJson,
} from './http/respond';
import { login, logout, refresh, register } from './routes/auth';
import { parseLimit, parseSince, pullEvents, pushEvents } from './routes/events';
import { resolveToken } from './auth/tokens';

export interface ServerConfig {
  readonly pool: Pool;
  /** Strict allow-list. Empty (the default) means no cross-origin access at all. */
  readonly allowedOrigins?: readonly string[];
  /** Injected so tests are deterministic; production passes nothing and gets Date.now. */
  readonly now?: () => number;
}

/** Resolves the bearer token to a shop id, or throws 401. Never trusts a shop_id from the body. */
async function requireShop(pool: Pool, req: IncomingMessage, now: number): Promise<string> {
  const token = bearerToken(req);
  if (token === null) {
    throw new HttpError(401, 'MISSING_TOKEN', 'Authorization: Bearer <token> is required.');
  }
  const shopId = await resolveToken(pool, token, 'ACCESS', now);
  if (shopId === null) {
    throw new HttpError(401, 'INVALID_TOKEN', 'Access token is unknown or expired.');
  }
  return shopId;
}

export function createServer(config: ServerConfig): Server {
  const { pool } = config;
  const allowedOrigins = config.allowedOrigins ?? [];
  const clock = config.now ?? Date.now;

  return createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    void handle(req, res).catch((error: unknown) => sendError(res, error));
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    applyCors(req, res, allowedOrigins);

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = `${req.method ?? 'GET'} ${url.pathname}`;
    const now = clock();

    switch (route) {
      case 'GET /health': {
        // Touches the database, so a green health check means the whole path
        // works — not just that the process is alive.
        await pool.query('SELECT 1');
        sendJson(res, 200, { status: 'ok' });
        return;
      }

      case 'POST /v1/auth/register': {
        sendJson(res, 201, await register(pool, await readJsonBody(req), now));
        return;
      }

      case 'POST /v1/auth/login': {
        sendJson(res, 200, await login(pool, await readJsonBody(req), now));
        return;
      }

      case 'POST /v1/auth/refresh': {
        sendJson(res, 200, await refresh(pool, await readJsonBody(req), now));
        return;
      }

      case 'POST /v1/auth/logout': {
        const shopId = await requireShop(pool, req, now);
        await logout(pool, shopId);
        sendJson(res, 200, { status: 'ok' });
        return;
      }

      case 'POST /v1/events': {
        const shopId = await requireShop(pool, req, now);
        sendJson(res, 200, await pushEvents(pool, shopId, await readJsonBody(req), now));
        return;
      }

      case 'GET /v1/events': {
        const shopId = await requireShop(pool, req, now);
        const since = parseSince(url.searchParams.get('since'));
        const limit = parseLimit(url.searchParams.get('limit'));
        sendJson(res, 200, await pullEvents(pool, shopId, since, limit));
        return;
      }

      default:
        sendJson(res, 404, { error: 'NOT_FOUND', message: `No route for ${route}.` });
    }
  }
}
