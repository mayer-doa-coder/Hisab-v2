// timing.ts — local-only timing instrumentation for UI_SPEC.md's acceptance
// criterion ("Credit entry: < 8 seconds, ≤ 5 taps... measured in a real
// shop"). A single manual stopwatch reading is weak evidence; this turns it
// into real data across every use during the pilot day. Writes to
// timing_log (schema.ts) — never folded, never synced, never an event.
//
// Two steps only, matching what was asked for: 'start' (flow entered) and
// 'confirm' (the action that completes it). Which UI event fires each is a
// screen concern (Step 8) — this file only knows how to log and read back.

import type { Database, SqlRow } from './db';

export type TimingStep = 'start' | 'confirm';

export interface TimingLogger {
  log(flow: string, step: TimingStep): Promise<void>;
}

export function createTimingLogger(db: Database, deviceId: string, now: () => number = Date.now): TimingLogger {
  return {
    async log(flow, step) {
      await db.runAsync('INSERT INTO timing_log (flow, step, occurred_at, device_id) VALUES (?, ?, ?, ?)', [
        flow,
        step,
        now(),
        deviceId,
      ]);
    },
  };
}

export interface FlowDuration {
  readonly flow: string;
  readonly startedAt: number;
  readonly confirmedAt: number;
  readonly durationMs: number;
}

interface TimingRow extends SqlRow {
  readonly step: string;
  readonly occurred_at: number;
}

/**
 * Pairs up 'start'/'confirm' rows for one flow into completed durations.
 * Rows are read in occurred_at order and paired greedily: a 'start' with no
 * following 'confirm' (the app was killed before the flow finished, or the
 * user abandoned it) is simply left unpaired, not reported as a duration —
 * an incomplete flow is not a timing measurement.
 */
export async function getFlowDurations(db: Database, flow: string): Promise<FlowDuration[]> {
  const rows = await db.getAllAsync<TimingRow>(
    'SELECT step, occurred_at FROM timing_log WHERE flow = ? ORDER BY occurred_at ASC',
    [flow],
  );

  const durations: FlowDuration[] = [];
  let pendingStart: number | null = null;

  for (const row of rows) {
    if (row.step === 'start') {
      pendingStart = row.occurred_at;
    } else if (row.step === 'confirm' && pendingStart !== null) {
      durations.push({
        flow,
        startedAt: pendingStart,
        confirmedAt: row.occurred_at,
        durationMs: row.occurred_at - pendingStart,
      });
      pendingStart = null;
    }
  }

  return durations;
}
