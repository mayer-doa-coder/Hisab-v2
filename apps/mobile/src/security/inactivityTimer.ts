// inactivityTimer.ts — SECURITY.md §2: "Auto-lock after inactivity. The
// phone sits on a counter. Default 5 minutes; make it configurable, not
// disableable."
//
// Pure state machine over injected timer functions (same discipline as
// sync/circuitBreaker.ts) — no RN dependency at all, so it is fully testable
// without a device. WIRING this to real touch events and to a real re-lock
// screen is Step 8's job (there is no screen to lock yet); this file is the
// primitive, same division as screenSecure.ts.
//
// "Not disableable": there is deliberately no `disable()` method and no
// zero/Infinity value accepted for the timeout — see the constructor guard.
// A shopkeeper can make the WINDOW longer via a settings screen (not built
// yet), never turn locking off entirely.

export const DEFAULT_INACTIVITY_MS = 5 * 60 * 1000;
/** A floor, not the UI's minimum — stops a settings screen from accidentally wiring in 0 and defeating the "not disableable" rule. */
const MIN_INACTIVITY_MS = 30 * 1000;

export interface InactivityTimerConfig {
  readonly timeoutMs?: number;
  readonly onLock: () => void;
  readonly setTimeout?: typeof globalThis.setTimeout;
  readonly clearTimeout?: typeof globalThis.clearTimeout;
}

export class InactivityTimer {
  private readonly timeoutMs: number;
  private readonly onLock: () => void;
  private readonly setTimer: typeof globalThis.setTimeout;
  private readonly clearTimer: typeof globalThis.clearTimeout;
  private handle: ReturnType<typeof globalThis.setTimeout> | null = null;
  private locked = false;

  constructor(config: InactivityTimerConfig) {
    const requested = config.timeoutMs ?? DEFAULT_INACTIVITY_MS;
    if (requested < MIN_INACTIVITY_MS) {
      throw new Error(`InactivityTimer: timeoutMs must be at least ${MIN_INACTIVITY_MS}ms (not disableable).`);
    }
    this.timeoutMs = requested;
    this.onLock = config.onLock;
    this.setTimer = config.setTimeout ?? globalThis.setTimeout;
    this.clearTimer = config.clearTimeout ?? globalThis.clearTimeout;
  }

  /** Call on app foreground / first mount. Starts the countdown. */
  start(): void {
    this.locked = false;
    this.reset();
  }

  /** Call on any user interaction — a tap, a keypress, a scroll. Cheap: a timer reset, nothing async. */
  recordActivity(): void {
    if (this.locked) return; // already locked; activity here means "unlock", not "extend" — the caller re-authenticates and calls start() again
    this.reset();
  }

  /** Call on app background. Stops the timer without firing onLock — going to background isn't "5 minutes idle in the foreground". */
  pause(): void {
    if (this.handle !== null) {
      this.clearTimer(this.handle);
      this.handle = null;
    }
  }

  isLocked(): boolean {
    return this.locked;
  }

  private reset(): void {
    this.pause();
    this.handle = this.setTimer(() => {
      this.locked = true;
      this.handle = null;
      this.onLock();
    }, this.timeoutMs);
  }
}
