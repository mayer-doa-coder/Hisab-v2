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
 * The receive-side variant is `tickReceive` below, added in Step 10 exactly
 * as this comment anticipated — without reworking this function.
 */
export function tick(state: HlcState, physicalNow: number): HlcState {
  const l = Math.max(state.l, physicalNow);
  const c = l === state.l ? state.c + 1 : 0;
  return { l, c };
}

/**
 * The RECEIVE side (Kulkarni et al., the `l_m`/`c_m` case). Called once per
 * remote event merged in, so this device's next locally-generated hlc sorts
 * after anything it has already seen:
 *
 *   l' = max(l, l_m, pt)
 *   c' = l'==l==l_m ? max(c, c_m)+1 : l'==l ? c+1 : l'==l_m ? c_m+1 : 0
 *
 * Convergence does not depend on this — fold() sorts by (hlc, device_id) and
 * is deterministic whatever the clocks did. What it buys is causality: an
 * event this device writes *after* seeing a remote event is guaranteed to
 * sort after it, so "I recorded this in response to that" survives the fold.
 * Without it, a device whose physical clock lags would keep minting hlcs that
 * sort before events it has already merged.
 */
export function tickReceive(state: HlcState, remote: HlcState, physicalNow: number): HlcState {
  const l = Math.max(state.l, remote.l, physicalNow);

  if (l === state.l && l === remote.l) return { l, c: Math.max(state.c, remote.c) + 1 };
  if (l === state.l) return { l, c: state.c + 1 };
  if (l === remote.l) return { l, c: remote.c + 1 };
  return { l, c: 0 };
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

  /**
   * Merges a remote event's hlc into this clock. Returns nothing — a received
   * event already has its own hlc and must never be restamped; this only
   * moves the local clock forward so the NEXT local event sorts after it.
   *
   * A malformed remote hlc is ignored rather than thrown: it comes from an
   * untrusted peer, the server already validated the format, and a sync pass
   * must not be aborted by one bad row.
   */
  receive(remoteHlc: string): void {
    let remote: HlcState;
    try {
      remote = decodeHlc(remoteHlc);
    } catch {
      return;
    }
    if (!Number.isFinite(remote.l) || !Number.isFinite(remote.c)) return;
    this.state = tickReceive(this.state, remote, this.now());
  }

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
