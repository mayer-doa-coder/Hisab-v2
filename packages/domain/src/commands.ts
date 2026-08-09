// commands.ts — AGENTS.md §3.1. applyCredit, applyPayment, applyCorrection.
//
// Each function validates only what EVENTS.md §8's anomaly-first design
// requires at write time, then delegates envelope assembly and payload
// validation entirely to events.ts's buildEvent() — never constructs an
// Event by hand, never duplicates buildEvent's Zod validation.
//
// Zero I/O (AGENTS.md §3.1): id, hlc, created_at, device_id, seq all come
// from cmd.ctx (CommandContext), exactly as events.ts's buildEvent() already
// requires. No Date.now(), no crypto.randomUUID(), anywhere in this file —
// that would be the same violation Step 4 avoided, just relocated here.

import { buildEvent } from './events';
import type {
  ApplyCorrection,
  ApplyCredit,
  ApplyPayment,
  DomainError,
} from './types';

function validationErrorToDomainError(
  eventLabel: string,
  fallbackCode: DomainError['code'],
  issues: readonly { readonly path: readonly (string | number)[]; readonly message: string }[],
): DomainError {
  return {
    code: fallbackCode,
    message: `${eventLabel} payload failed validation: ${issues.map((i) => i.message).join('; ')}`,
  };
}

/**
 * Validates only `amount_poisha > 0` (EVENTS.md §3: "positive integer").
 * Does NOT check the customer exists or is archived — not asked for by this
 * step; see the accompanying report for why that's a real open question, not
 * an oversight.
 */
export const applyCredit: ApplyCredit = (_state, cmd) => {
  if (cmd.amount_poisha <= 0) {
    return { code: 'AMOUNT_NOT_POSITIVE', message: 'CREDIT_GIVEN amount_poisha must be a positive integer.' };
  }

  const built = buildEvent(
    'CREDIT_GIVEN',
    {
      schema_version: 1,
      entry_id: cmd.entry_id,
      customer_id: cmd.customer_id,
      amount_poisha: cmd.amount_poisha,
      note: cmd.note,
      occurred_at: cmd.occurred_at,
    },
    cmd.ctx,
  );

  if ('kind' in built) {
    return validationErrorToDomainError('CREDIT_GIVEN', 'AMOUNT_NOT_INTEGER', built.issues);
  }

  return [built];
};

/**
 * Validates only `amount_poisha > 0`. Deliberately does NOT check the
 * payment against `state.balances` — EVENTS.md §8: "anomaly detection never
 * blocks a write." A payment that overpays a locally-known balance is valid,
 * expected data under offline sync; rejecting it here would mean refusing to
 * record cash the shopkeeper actually received. `anomalies.ts` catches the
 * resulting negative balance after the fold, not this function before it.
 */
export const applyPayment: ApplyPayment = (_state, cmd) => {
  if (cmd.amount_poisha <= 0) {
    return { code: 'AMOUNT_NOT_POSITIVE', message: 'PAYMENT_RECEIVED amount_poisha must be a positive integer.' };
  }

  const built = buildEvent(
    'PAYMENT_RECEIVED',
    {
      schema_version: 1,
      entry_id: cmd.entry_id,
      customer_id: cmd.customer_id,
      amount_poisha: cmd.amount_poisha,
      note: cmd.note,
      occurred_at: cmd.occurred_at,
    },
    cmd.ctx,
  );

  if ('kind' in built) {
    return validationErrorToDomainError('PAYMENT_RECEIVED', 'AMOUNT_NOT_INTEGER', built.issues);
  }

  return [built];
};

/**
 * Deliberately does NOT reject voiding an already-voided target —
 * EVENTS.md §3: "Voiding is idempotent: two ENTRY_VOIDED events for the same
 * target have the same effect as one," and fold.ts already guarantees this
 * at the fold level via a Set. Rejecting a double-void here would be
 * stricter than the system's own guarantee.
 *
 * The one validation this function is missing — confirming `voids_event_id`
 * actually exists in the log — is NOT implemented. `LedgerState` does not
 * retain raw events (DECISIONS.md 2026-08-08, "LedgerState does not retain
 * the events it folded"), and `ApplyCorrection`'s committed signature is
 * `(state, cmd) => ...` with no events parameter, so there is currently no
 * data this function can check that against. See the accompanying report —
 * this needs a decision (a new LedgerState field, or a signature change
 * mirroring DetectAnomalies's `events` parameter), not a silent fix.
 */
export const applyCorrection: ApplyCorrection = (_state, cmd) => {
  const built = buildEvent(
    'ENTRY_VOIDED',
    {
      schema_version: 1,
      voids_event_id: cmd.voids_event_id,
      reason: cmd.reason,
    },
    cmd.ctx,
  );

  if ('kind' in built) {
    return validationErrorToDomainError('ENTRY_VOIDED', 'UNKNOWN_EVENT', built.issues);
  }

  return [built];
};
