// rateEnvelope.ts — SECURITY.md §5: "Per-user, per-event-type mutation rate
// envelopes. A legitimate shop does not create 5,000 credit events in a day;
// anomalous volume is a reliable signal."
//
// A DIFFERENT KIND OF CHECK from the balance-exceeded rejection this project
// removed in Step 10 (docs/DECISIONS.md 2026-08-15). That rejection was
// wrong because it evaluated an event's CONTENT against derived business
// state the server does not authoritatively hold — two devices pushing in
// different orders would get different verdicts for the identical two
// events. A rate envelope evaluates something else: how many events of a
// type this authenticated shop has pushed in a window, which is symmetric
// under push order (it's a count, not a fold) and is an operational/abuse
// signal (threat model item 5: "a malicious or compromised client submitting
// fabricated events"), not a business-state judgement about any one event.
// Rejecting on volume does not make two otherwise-identical pushes disagree
// depending on arrival order the way the balance check did.
//
// UNTUNED, same as anomalies.ts's DUPLICATE_SUSPECTED_WINDOW_MS: no pilot
// data exists yet to calibrate a real shop's plausible daily volume against.
// Set intentionally low enough to catch a scripted flood, and intentionally
// far above anything a real counter could produce by hand — 2,000 events of
// one type in 24h is one every ~43 seconds, sustained, all day.

import type { Pool } from '../db/pool';

export const RATE_ENVELOPE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const RATE_ENVELOPE_THRESHOLD = 2_000;

/**
 * Counts existing events of `type` for `shopId` in the trailing window, ONCE
 * per push call — not once per event — so a 500-event batch costs one query,
 * not 500. The caller tracks how many MORE of that type it's about to add
 * from the batch itself and stops accepting once the running total would
 * cross the threshold.
 */
export async function countRecentEvents(
  pool: Pool,
  shopId: string,
  type: string,
  now: number,
): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    'SELECT COUNT(*) AS count FROM events WHERE shop_id = $1 AND type = $2 AND received_at > $3',
    [shopId, type, now - RATE_ENVELOPE_WINDOW_MS],
  );
  return Number(rows[0]?.count ?? 0);
}
