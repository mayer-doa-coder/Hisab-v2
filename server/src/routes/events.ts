// events.ts — POST /v1/events (push) and GET /v1/events?since= (pull).
//
// Idempotency is free and stays free: event ids are device-generated UUIDs,
// so `INSERT ... ON CONFLICT (id) DO NOTHING` is the whole mechanism.
// AGENTS.md §7 / SECURITY.md §5: "No idempotency hash table, no 24-hour TTL,
// no IdempotencyRecord model. [v1 had all three]" — do not reintroduce one.
//
// The push handler NEVER rejects an event for conflicting with derived state.
// See server/src/validate.ts and docs/SECURITY.md §5 (corrected 2026-08-15).

import { z } from 'zod';
import type { Pool } from '../db/pool';
import { HttpError, MAX_BATCH_EVENTS } from '../http/respond';
import { countRecentEvents, RATE_ENVELOPE_THRESHOLD } from '../security/rateEnvelope';
import { validateIncomingEvent, type EventRejection } from '../validate';

const PushSchema = z.object({ events: z.array(z.unknown()) });
const DEFAULT_PULL_LIMIT = 500;
const MAX_PULL_LIMIT = 1000;

export interface PushResult {
  /** Ids the server holds after this call — accepted now or already present. */
  readonly accepted: readonly string[];
  /** Ids already stored before this call. Not an error; the client clears them too. */
  readonly duplicates: readonly string[];
  readonly rejected: readonly EventRejection[];
  /** Highest server_seq now visible to this shop, so the client can advance its cursor. */
  readonly server_seq: number;
}

export async function pushEvents(
  pool: Pool,
  shopId: string,
  body: unknown,
  now: number,
  /** Overridable so a test can prove the rejection path without pushing 2,000 real events first. Production never passes this. */
  rateThreshold: number = RATE_ENVELOPE_THRESHOLD,
): Promise<PushResult> {
  const parsed = PushSchema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(400, 'INVALID_BODY', 'Body must be { events: [...] }.');
  }

  const { events } = parsed.data;
  if (events.length > MAX_BATCH_EVENTS) {
    throw new HttpError(
      413,
      'BATCH_TOO_LARGE',
      `Batch of ${events.length} exceeds the cap of ${MAX_BATCH_EVENTS} events.`,
    );
  }

  const accepted: string[] = [];
  const duplicates: string[] = [];
  const rejected: EventRejection[] = [];

  // One count query per TYPE actually present in the batch, not per event —
  // a 500-event batch of one type costs one query. Tracks additions from
  // this batch in-memory so the running total is checked, not just the
  // pre-batch snapshot (otherwise a single huge batch could sail through
  // entirely on a stale count).
  const runningCounts = new Map<string, number>();

  for (const raw of events) {
    const result = validateIncomingEvent(raw, shopId);
    if (!result.ok) {
      rejected.push(result.rejection);
      continue;
    }

    const event = result.event;

    let count = runningCounts.get(event.type);
    if (count === undefined) {
      count = await countRecentEvents(pool, shopId, event.type, now);
    }
    if (count >= rateThreshold) {
      // A volume signal, not a content judgement — see rateEnvelope.ts's
      // header for why this is a different category from the
      // balance-exceeded rejection this project removed in Step 10.
      rejected.push({
        id: event.id,
        reason: 'RATE_ENVELOPE_EXCEEDED',
        detail: `shop has already recorded ${count} ${event.type} events in the last 24h`,
      });
      continue;
    }
    runningCounts.set(event.type, count + 1);

    const inserted = await pool.query(
      `INSERT INTO events (id, device_id, seq, hlc, shop_id, type, payload, created_at, received_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO NOTHING`,
      [
        event.id,
        event.device_id,
        event.seq,
        event.hlc,
        event.shop_id,
        event.type,
        JSON.stringify(event.payload),
        event.created_at,
        now,
      ],
    );

    // rowCount 0 means ON CONFLICT fired: the server already had this exact
    // id. That is a successful re-push, not a failure — the client should
    // stop resending it, same as for a fresh insert.
    if (inserted.rowCount === 0) {
      duplicates.push(event.id);
    } else {
      accepted.push(event.id);
    }
  }

  return { accepted, duplicates, rejected, server_seq: await maxServerSeq(pool, shopId) };
}

export interface StoredEvent {
  readonly id: string;
  readonly device_id: string;
  readonly seq: number;
  readonly hlc: string;
  readonly shop_id: string;
  readonly type: string;
  readonly payload: unknown;
  readonly created_at: number;
  readonly received_at: number;
  readonly server_seq: number;
}

export interface PullResult {
  readonly events: readonly StoredEvent[];
  /** Highest server_seq in this page; the client advances its cursor to this and no further. */
  readonly server_seq: number;
}

/**
 * `shop_id = $1` is in the WHERE clause, not in a caller-side check —
 * SECURITY.md §5: "A shop can only ever read or write events for its own
 * shop_id. Enforced in the query, not in application logic that can be
 * forgotten."
 */
export async function pullEvents(
  pool: Pool,
  shopId: string,
  since: number,
  limit: number = DEFAULT_PULL_LIMIT,
): Promise<PullResult> {
  const capped = Math.min(Math.max(1, limit), MAX_PULL_LIMIT);

  const { rows } = await pool.query<StoredEvent>(
    `SELECT id, device_id, seq, hlc, shop_id, type, payload, created_at, received_at, server_seq
       FROM events
      WHERE shop_id = $1 AND server_seq > $2
      ORDER BY server_seq ASC
      LIMIT $3`,
    [shopId, since, capped],
  );

  // The cursor advances only to what was actually returned, never to the
  // table's current max — see docs/DECISIONS.md 2026-08-15 on the
  // uncommitted-BIGSERIAL gap.
  const highest = rows.length > 0 ? (rows[rows.length - 1]?.server_seq ?? since) : since;
  return { events: rows, server_seq: highest };
}

export function parseSince(value: string | null): number {
  if (value === null || value === '') return 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new HttpError(400, 'INVALID_SINCE', '`since` must be a non-negative integer.');
  }
  return parsed;
}

async function maxServerSeq(pool: Pool, shopId: string): Promise<number> {
  const { rows } = await pool.query<{ max: number | null }>(
    'SELECT MAX(server_seq) AS max FROM events WHERE shop_id = $1',
    [shopId],
  );
  return rows[0]?.max ?? 0;
}
