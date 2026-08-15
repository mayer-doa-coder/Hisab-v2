// backoff.ts — exponential backoff with jitter. BUILD_PLAN.md Phase 3.
//
// Pure functions taking `random` as a parameter, for the same reason clock.ts
// takes `physicalNow`: a retry policy you cannot test deterministically is a
// retry policy nobody checks. This file is outside packages/domain's ESLint
// scope but follows the same discipline by hand.
//
// Full jitter (delay = random(0, cappedExponential)), not "exponential plus a
// small random nudge". With many devices in one area coming back online after
// the same tower outage — the realistic failure mode here, not a hypothetical
// one — equal-jitter still leaves a synchronised floor that keeps them
// stacked. Full jitter spreads the retries across the whole window.

export interface BackoffPolicy {
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  /** After this many consecutive failures the caller should stop retrying this pass. */
  readonly maxAttempts: number;
}

export const DEFAULT_BACKOFF: BackoffPolicy = {
  baseDelayMs: 1_000,
  // A shop can be offline all day. Capping at ~5 minutes means a device that
  // regains signal is never more than five minutes from trying again, while
  // still being gentle on a server coming back from an outage.
  maxDelayMs: 5 * 60 * 1_000,
  maxAttempts: 8,
};

/**
 * `attempt` is 0-based: attempt 0 is the first retry after one failure.
 * Returns a delay in [0, min(base * 2^attempt, max)].
 */
export function backoffDelay(
  attempt: number,
  policy: BackoffPolicy = DEFAULT_BACKOFF,
  random: () => number = Math.random,
): number {
  const exponential = policy.baseDelayMs * 2 ** Math.max(0, attempt);
  const capped = Math.min(exponential, policy.maxDelayMs);
  return Math.floor(random() * capped);
}

export function shouldRetry(attempt: number, policy: BackoffPolicy = DEFAULT_BACKOFF): boolean {
  return attempt < policy.maxAttempts;
}
