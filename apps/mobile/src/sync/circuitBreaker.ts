// circuitBreaker.ts — BUILD_PLAN.md Phase 3.
//
// The point of this on a shop counter is battery and radio, not server load.
// A device with no connectivity that keeps retrying every few seconds burns
// power all day for nothing. Opening the circuit after repeated failures
// stops that; the half-open probe is what closes it again without the user
// doing anything.
//
// `now` is injected rather than read, so the state machine is testable
// without waiting real seconds.

export type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface BreakerPolicy {
  /** Consecutive failures before the circuit opens. */
  readonly failureThreshold: number;
  /** How long it stays open before allowing one probe. */
  readonly resetAfterMs: number;
}

export const DEFAULT_BREAKER: BreakerPolicy = {
  failureThreshold: 5,
  resetAfterMs: 60_000,
};

export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;

  constructor(
    private readonly policy: BreakerPolicy = DEFAULT_BREAKER,
    private readonly now: () => number = Date.now,
  ) {}

  state(): BreakerState {
    if (this.openedAt === null) return 'CLOSED';
    return this.now() - this.openedAt >= this.policy.resetAfterMs ? 'HALF_OPEN' : 'OPEN';
  }

  /** False only while fully OPEN. HALF_OPEN allows exactly one probe through. */
  canAttempt(): boolean {
    return this.state() !== 'OPEN';
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.failures >= this.policy.failureThreshold) {
      // Re-stamped on every failure at or past the threshold, so a failed
      // half-open probe restarts the full wait instead of retrying immediately.
      this.openedAt = this.now();
    }
  }

  /** Diagnostics only — never rendered. UI_SPEC.md: no offline banner. */
  consecutiveFailures(): number {
    return this.failures;
  }
}
