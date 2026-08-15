// backgroundTask.ts — the periodic driver for SyncEngine.
//
// Deliberately NOT expo-background-task / expo-task-manager. Those are real
// native modules with a real APK cost, and the 2026-08-15 measurement leaves
// 2.73 MB of headroom for the design system, six screens, i18n, and
// eventually a sub-2 MB voice model (DECISIONS.md). A JS-timer loop that runs
// while the app is foregrounded covers the actual case — a shopkeeper with
// the app open at a counter — and the OS-scheduled variant can be added when
// there is evidence it is needed and budget to pay for it. AGENTS.md §3.4:
// never add a dependency without saying what it costs.
//
// Consequence, stated rather than hidden: this does not sync while the app is
// backgrounded or killed. Nothing is lost — every write is already durable
// locally, and the next foreground pass pushes it — but "synced" can lag by
// however long the app was closed. UI_SPEC.md's per-row pending dot is what
// makes that visible, and the loud warning at logout is what makes it safe.

import { SyncEngine, type SyncOutcome } from './syncEngine';

export interface BackgroundSyncConfig {
  readonly engine: SyncEngine;
  /** How often to attempt a pass while foregrounded. */
  readonly intervalMs?: number;
  readonly setInterval?: typeof globalThis.setInterval;
  readonly clearInterval?: typeof globalThis.clearInterval;
  readonly onOutcome?: (outcome: SyncOutcome) => void;
}

/** Two minutes: frequent enough that a second device sees changes quickly, rare enough not to matter for battery. */
const DEFAULT_INTERVAL_MS = 2 * 60 * 1_000;

export interface BackgroundSync {
  start(): void;
  stop(): void;
  isRunning(): boolean;
}

export function createBackgroundSync(config: BackgroundSyncConfig): BackgroundSync {
  const intervalMs = config.intervalMs ?? DEFAULT_INTERVAL_MS;
  const setTimer = config.setInterval ?? globalThis.setInterval;
  const clearTimer = config.clearInterval ?? globalThis.clearInterval;

  let handle: ReturnType<typeof globalThis.setInterval> | null = null;

  function pass(): void {
    // The engine already coalesces concurrent passes and owns the circuit
    // breaker, so a slow pass overlapping the next tick is safe.
    void config.engine
      .syncOnce()
      .then((outcome) => config.onOutcome?.(outcome))
      .catch((error: unknown) => {
        // A sync failure is never surfaced to the shopkeeper (UI_SPEC.md: no
        // offline banner). It is logged for diagnostics and nothing else.
        console.warn('[sync] background pass failed:', error instanceof Error ? error.message : String(error));
      });
  }

  return {
    start() {
      if (handle !== null) return;
      handle = setTimer(pass, intervalMs);
      pass(); // one immediate attempt, so opening the app syncs without waiting a full interval
    },
    stop() {
      if (handle === null) return;
      clearTimer(handle);
      handle = null;
    },
    isRunning() {
      return handle !== null;
    },
  };
}
