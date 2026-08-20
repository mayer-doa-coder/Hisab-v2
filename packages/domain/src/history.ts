// history.ts — customerHistory(events, customerId): the per-line running
// balance UI_SPEC.md screen 6 ("Running balance, full history") needs.
//
// fold.ts deliberately only returns a final LedgerState — DECISIONS.md
// 2026-08-08 ("LedgerState does not retain the events it folded") keeps the
// state object from turning into v1's AppDataContext. A running-balance
// TIMELINE is a different shape from a final state, and there was no export
// that produced it. Added here rather than bolted onto fold.ts, which stays
// the hot path for the six core events.
//
// Zero I/O (AGENTS.md §3.1). Balance arithmetic goes through money.ts's
// add/subtract exclusively (AGENTS.md §3.2).

import { add, subtract } from './money';
import { compareByHlc } from './ordering';
import type { AnyEvent, Poisha } from './types';

/** One line of a customer's ledger, in causal order, oldest first. */
export interface CustomerHistoryLine {
  readonly event: AnyEvent;
  /** True when an ENTRY_VOIDED targets this event — its effect did not happen. */
  readonly voided: boolean;
  /**
   * The balance immediately after this line. Unchanged from the previous
   * line when `voided` is true — a voided line's whole point is that nothing
   * moved.
   */
  readonly balance_after_poisha: Poisha;
}

function directCustomerId(payload: unknown): string | null {
  const record = payload as Record<string, unknown>;
  return typeof record.customer_id === 'string' ? record.customer_id : null;
}

function voidsEventId(payload: unknown): string | null {
  const record = payload as Record<string, unknown>;
  return typeof record.voids_event_id === 'string' ? record.voids_event_id : null;
}

/**
 * The credit/payment ledger for one customer: CREDIT_GIVEN and
 * PAYMENT_RECEIVED lines belonging to them, plus any ENTRY_VOIDED targeting
 * one of those two — voided lines are kept (marked, not dropped), so the
 * shopkeeper sees the same mutually-visible record a crossed-out paper
 * ledger line would show, matching UI_SPEC.md's "full history."
 *
 * `events` need not already belong to this customer or be sorted — this
 * function filters and sorts internally, the same discipline fold() applies,
 * so a caller cannot get a different answer by handing in events in a
 * different order.
 */
export function customerHistory(
  events: readonly AnyEvent[],
  customerId: string,
): CustomerHistoryLine[] {
  const sorted = [...events].sort(compareByHlc);

  const ownedIds = new Set<string>();
  for (const event of sorted) {
    if (
      (event.type === 'CREDIT_GIVEN' || event.type === 'PAYMENT_RECEIVED') &&
      directCustomerId(event.payload) === customerId
    ) {
      ownedIds.add(event.id);
    }
  }

  const relevant = sorted.filter((event) => {
    if (event.type === 'CREDIT_GIVEN' || event.type === 'PAYMENT_RECEIVED') {
      return directCustomerId(event.payload) === customerId;
    }
    if (event.type === 'ENTRY_VOIDED') {
      const target = voidsEventId(event.payload);
      return target !== null && ownedIds.has(target);
    }
    return false;
  });

  const voidedTargets = new Set<string>();
  for (const event of relevant) {
    if (event.type === 'ENTRY_VOIDED') {
      voidedTargets.add(event.payload.voids_event_id);
    }
  }

  const lines: CustomerHistoryLine[] = [];
  let balance = 0 as Poisha;

  for (const event of relevant) {
    if (event.type === 'ENTRY_VOIDED') {
      // The void event itself is not a ledger line — it is recorded by
      // marking the line it targets, below.
      continue;
    }

    const isVoided = voidedTargets.has(event.id);
    if (!isVoided) {
      if (event.type === 'CREDIT_GIVEN') {
        balance = add(balance, event.payload.amount_poisha);
      } else if (event.type === 'PAYMENT_RECEIVED') {
        balance = subtract(balance, event.payload.amount_poisha);
      }
    }

    lines.push({ event, voided: isVoided, balance_after_poisha: balance });
  }

  return lines;
}
