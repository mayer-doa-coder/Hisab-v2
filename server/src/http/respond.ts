// respond.ts — the whole HTTP plumbing layer. docs/SECURITY.md §5's
// "Helmet, strict CORS allow-list in production, and request size limits".
//
// This is the ~40 lines that stand in for helmet + cors + body-parser. The
// body cap in particular is stricter than a framework default: it aborts the
// stream the moment the cap is exceeded rather than buffering the whole body
// and then rejecting it, so an oversized push cannot consume memory
// proportional to its own size. See docs/DECISIONS.md 2026-08-15.

import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * The helmet-equivalent set, minus the ones that only mean something for an
 * HTML response (this server returns JSON exclusively, so CSP and
 * X-XSS-Protection have nothing to protect). HSTS is included because
 * SECURITY.md §3 requires TLS-only and rejecting cleartext.
 */
const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Cache-Control': 'no-store',
};

/** SECURITY.md §5: batch size cap on the push endpoint, with a byte limit per event. */
export const MAX_BODY_BYTES = 1024 * 1024; // 1 MB
export const MAX_BATCH_EVENTS = 500;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(name, value);
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(payload));
  res.statusCode = status;
  res.end(payload);
}

export function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof HttpError) {
    sendJson(res, error.status, { error: error.code, message: error.message });
    return;
  }
  // Never leak an internal message or stack to the client. AGENTS.md §8:
  // log ids, never content — so nothing about the request body goes out here.
  console.error('[server] unhandled error:', error);
  sendJson(res, 500, { error: 'INTERNAL', message: 'Internal server error.' });
}

/**
 * Reads a JSON body, refusing anything over MAX_BODY_BYTES mid-stream.
 * Returns `unknown` on purpose: nothing downstream may assume a shape that a
 * Zod schema has not confirmed.
 */
export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      req.destroy();
      throw new HttpError(413, 'BODY_TOO_LARGE', `Request body exceeds ${MAX_BODY_BYTES} bytes.`);
    }
    chunks.push(buf);
  }

  if (total === 0) return undefined;

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'MALFORMED_JSON', 'Request body is not valid JSON.');
  }
}

/**
 * Strict allow-list, and an empty list means no cross-origin access at all.
 * The mobile client is not a browser and sends no Origin, so it is unaffected
 * — this exists for the case where something browser-based is ever pointed at
 * the API, not to make that easy.
 */
export function applyCors(req: IncomingMessage, res: ServerResponse, allowedOrigins: readonly string[]): void {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
}

export function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer (.+)$/.exec(header);
  return match?.[1] ?? null;
}
