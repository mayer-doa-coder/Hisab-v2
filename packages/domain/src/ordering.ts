// ordering.ts — the two log-scan primitives shared by every fold in this
// package. Extracted from fold.ts in Step 12 (not rewritten: the bodies are
// byte-identical to what fold.ts had) so that inventory.ts can reuse them
// without either importing the other — a fold.ts <-> inventory.ts cycle would
// otherwise be unavoidable, since fold.ts also calls foldInventory().
//
// Internal to the package. NOT exported from index.ts: ordering is how the
// domain guarantees determinism, not something a caller should be able to
// reach around.
//
// Zero I/O (AGENTS.md §3.1).

import type { AnyEvent } from './types';

/**
 * EVENTS.md §1 invariant 3: "Ordering is by hlc, then device_id as a
 * tiebreak." Every fold sorts internally rather than trusting the caller, so
 * order-independence is a property of the function, not an assumption about
 * its input.
 */
export function compareByHlc(a: AnyEvent, b: AnyEvent): number {
  if (a.hlc < b.hlc) return -1;
  if (a.hlc > b.hlc) return 1;
  if (a.device_id < b.device_id) return -1;
  if (a.device_id > b.device_id) return 1;
  return 0;
}

/**
 * Every `voids_event_id` referenced by any `ENTRY_VOIDED` in the log, from a
 * full scan independent of processing order. Using a Set makes two
 * `ENTRY_VOIDED`s for the same target collapse to one automatically — that is
 * the idempotency guarantee (EVENTS.md §3), not a separate check.
 */
export function collectVoidedIds(events: readonly AnyEvent[]): ReadonlySet<string> {
  const voided = new Set<string>();
  for (const event of events) {
    if (event.type === 'ENTRY_VOIDED') {
      voided.add(event.payload.voids_event_id);
    }
  }
  return voided;
}
