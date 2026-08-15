// validate.ts — server-side event validation. docs/SECURITY.md §5.
//
// THE RULE THIS FILE EXISTS TO ENFORCE (SECURITY.md §5, corrected
// 2026-08-15): the server may reject an event that could never be valid in
// any state; it may NOT reject one that is invalid only relative to a state
// it does not authoritatively hold.
//
// So: no balance check, no stock check, no fold. A payment that overdraws the
// balance is a valid event — EVENTS.md §8, "anomaly detection never blocks a
// write" — and it is `anomalies.ts` after the fold, on the device, that
// surfaces it to the shopkeeper. There is deliberately no `balances` table on
// this server to check against even if someone later tries.
//
// PAYLOAD VALIDATION IS NOT REIMPLEMENTED HERE. `buildEvent` from
// @hisab/domain runs the exact Zod schemas the client writes with
// (packages/domain/src/events.ts, Step 4). Two implementations of the same
// validation would drift, and when they did there would be no ground truth —
// AGENTS.md §4.3, a named v1 failure. This file adds only the checks that are
// meaningless on-device: envelope well-formedness from an untrusted peer, and
// an absurd-value ceiling.

import { buildEvent } from '@hisab/domain';
import type { AnyEvent } from '@hisab/domain';

/**
 * ৳1,000,000,000 expressed in poisha. Not a business rule and not a balance
 * check — a shop transaction above a billion taka is a corrupted payload or a
 * hostile client, and that is true regardless of any state. The bound is
 * per-event and state-independent, which is exactly what makes it legitimate
 * under the rule at the top of this file.
 */
export const MAX_MONEY_MAGNITUDE = 100_000_000_000;

export interface EventRejection {
  readonly id: string | null;
  readonly reason: string;
  readonly detail: string;
}

export type ValidatedEvent = { readonly ok: true; readonly event: AnyEvent };
export type RejectedEvent = { readonly ok: false; readonly rejection: EventRejection };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** clock.ts's encoding: 15-digit l, 5-digit c, then the device id. */
const HLC_RE = /^\d{15}-\d{5}-.+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Any field whose name ends in `_poisha`, anywhere in the payload, checked
 * against the ceiling. Written as a scan rather than per-event-type so a new
 * money field in a future event is covered the day it is added, instead of
 * the day someone remembers to add it here.
 */
function findAbsurdMoney(payload: Record<string, unknown>): string | null {
  for (const [key, value] of Object.entries(payload)) {
    if (!key.endsWith('_poisha')) continue;
    if (value === null) continue;
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      return `${key} must be an integer number of poisha`;
    }
    if (Math.abs(value) > MAX_MONEY_MAGNITUDE) {
      return `${key} exceeds the absurd-value ceiling of ${MAX_MONEY_MAGNITUDE} poisha`;
    }
  }
  return null;
}

/**
 * Validates one event received from a client, for one authenticated shop.
 *
 * `shopId` is the shop the bearer token resolved to — never the shop_id in
 * the body. SECURITY.md §5: "A shop can only ever read or write events for
 * its own shop_id."
 */
export function validateIncomingEvent(raw: unknown, shopId: string): ValidatedEvent | RejectedEvent {
  const reject = (id: string | null, reason: string, detail: string): RejectedEvent => ({
    ok: false,
    rejection: { id, reason, detail },
  });

  if (!isRecord(raw)) return reject(null, 'MALFORMED', 'Event is not an object.');

  const id = typeof raw.id === 'string' ? raw.id : null;

  if (id === null || !UUID_RE.test(id)) {
    return reject(id, 'BAD_ID', 'Event id must be a UUID (EVENTS.md §1: UUIDv7, generated on-device).');
  }
  if (typeof raw.device_id !== 'string' || raw.device_id.length === 0) {
    return reject(id, 'BAD_DEVICE_ID', 'device_id must be a non-empty string.');
  }
  if (typeof raw.seq !== 'number' || !Number.isInteger(raw.seq) || raw.seq < 1) {
    return reject(id, 'BAD_SEQ', 'seq must be an integer >= 1 (EVENTS.md §1: monotonic per device, starts at 1).');
  }
  if (typeof raw.hlc !== 'string' || !HLC_RE.test(raw.hlc)) {
    return reject(id, 'BAD_HLC', 'hlc must match the encoding in apps/mobile/src/data/clock.ts.');
  }
  if (typeof raw.created_at !== 'number' || !Number.isInteger(raw.created_at)) {
    return reject(id, 'BAD_CREATED_AT', 'created_at must be an integer epoch-ms value.');
  }
  if (raw.shop_id !== shopId) {
    // Not "the shop_id is malformed" — this is a client trying to write into
    // another shop's ledger, and it is refused on identity, not on shape.
    return reject(id, 'WRONG_SHOP', 'Event shop_id does not match the authenticated shop.');
  }
  if (typeof raw.type !== 'string') {
    return reject(id, 'BAD_TYPE', 'type must be a string.');
  }
  if (!isRecord(raw.payload)) {
    return reject(id, 'BAD_PAYLOAD', 'payload must be an object.');
  }

  const absurd = findAbsurdMoney(raw.payload);
  if (absurd !== null) {
    return reject(id, 'ABSURD_AMOUNT', absurd);
  }

  // The reuse point. buildEvent runs the same Zod schema the client ran, and
  // reassembles the envelope from the client's own values — so what is stored
  // is byte-identical to what the device wrote, not a server reinterpretation.
  const built = buildEvent(raw.type, raw.payload, {
    event_id: id,
    device_id: raw.device_id,
    seq: raw.seq,
    hlc: raw.hlc,
    shop_id: shopId,
    created_at: raw.created_at,
  });

  if ('kind' in built) {
    return reject(id, 'SCHEMA', built.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }

  return { ok: true, event: built };
}
