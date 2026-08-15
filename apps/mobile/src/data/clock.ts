// clock.ts — Hybrid Logical Clock (Kulkarni et al.), confirmed hand-rolled
// over a library in this step's report: no HLC package on npm clears
// CONTRIBUTING.md §6's bar (all under 100 weekly downloads, one five years
// unmaintained), and the algorithm itself is small enough to test exhaustively
// by hand rather than trust to an unaudited dependency.
//
// Zero I/O in this file: `tick` takes `physicalNow` as a parameter rather
// than reading Date.now() itself, so it's a pure, deterministic function —
// the same discipline packages/domain's ESLint guard enforces, applied here
// by hand since this file lives outside packages/domain's rule scope.
//
// Encoding: `l` as a 15-digit zero-padded epoch-ms string (good until the
// year 5138), `c` as a 5-digit zero-padded counter, then deviceId — chosen
// so plain string comparison order matches HLC order, matching how
// packages/domain/src/fold.ts already sorts by (hlc, device_id).

import type { Database } from './db';

export interface HlcState {
  readonly l: number;
  readonly c: number;
}

export const ZERO_HLC_STATE: HlcState = { l: 0, c: 0 };

/**
 * One tick of the LOCAL-event side of the algorithm:
 *   l' = max(l, physicalNow())
 *   c' = (l' == l) ? c + 1 : 0
 * The receive-side variant (merging in a remote HLC) is Step 10's job — not
 * built here, but this function's pure (state, now) -> state shape is
 * exactly what Step 10 needs to extend without reworking this file.
 */
export function tick(state: HlcState, physicalNow: number): HlcState {
  const l = Math.max(state.l, physicalNow);
  const c = l === state.l ? state.c + 1 : 0;
  return { l, c };
}

export function encodeHlc(state: HlcState, deviceId: string): string {
  return `${String(state.l).padStart(15, '0')}-${String(state.c).padStart(5, '0')}-${deviceId}`;
}

export function decodeHlc(hlc: string): HlcState & { deviceId: string } {
  const parts = hlc.split('-');
  const [lStr, cStr, ...rest] = parts;
  if (lStr === undefined || cStr === undefined || rest.length === 0) {
    throw new Error(`decodeHlc: malformed hlc "${hlc}"`);
  }
  return { l: Number(lStr), c: Number(cStr), deviceId: rest.join('-') };
}

/**
 * A stateful clock for one device. Bootstraps from whatever (l, c) it's
 * given — eventStore.ts seeds this from the max hlc already stored for this
 * device_id, so restarting the app can't regress the clock backward even
 * without a dedicated persistence mechanism: the events table itself is the
 * durable record.
 */
export class Clock {
  private state: HlcState;
  private readonly deviceId: string;
  private readonly now: () => number;

  constructor(deviceId: string, initialState: HlcState = ZERO_HLC_STATE, now: () => number = Date.now) {
    this.deviceId = deviceId;
    this.state = initialState;
    this.now = now;
  }

  /** Advances the clock and returns the new encoded hlc string. */
  next(): string {
    this.state = tick(this.state, this.now());
    return encodeHlc(this.state, this.deviceId);
  }

  /** Exposed for Step 10's receive-side merge to read/seed from. */
  getState(): HlcState {
    return this.state;
  }
}

/**
 * Constructs a Clock seeded from this device's own last-known hlc, so a
 * restart can't produce an hlc lower than one already written by this same
 * device. `Clock`'s constructor has always accepted an initialState
 * parameter for exactly this — this function is the piece that was
 * previously missing: nothing called it with a real value, so every fresh
 * Clock silently started at ZERO_HLC_STATE regardless of prior history.
 * Found during audit, not exercised by a test until this fix.
 */
export async function createDeviceClock(
  db: Database,
  deviceId: string,
  now: () => number = Date.now,
): Promise<Clock> {
  const rows = await db.getAllAsync<{ hlc: string }>(
    'SELECT hlc FROM events WHERE device_id = ? ORDER BY hlc DESC LIMIT 1',
    [deviceId],
  );
  const lastHlc = rows[0]?.hlc;
  const initialState = lastHlc !== undefined ? decodeHlc(lastHlc) : ZERO_HLC_STATE;
  return new Clock(deviceId, initialState, now);
}
