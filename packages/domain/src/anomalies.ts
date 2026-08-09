// anomalies.ts — EVENTS.md §8. Detected after the fold, never blocking a
// write.
//
// NEGATIVE_STOCK stays in the Anomaly union (types.ts, mirroring EVENTS.md
// §8) but is not implemented here — stock doesn't exist until Step 12.
//
// Zero I/O (AGENTS.md §3.1): the DUPLICATE_SUSPECTED window compares two
// event timestamps already in the log to each other. No Date.now(), no
// crypto.randomUUID(), anywhere in this file.

import { isNegative } from './money';
import type { Anomaly, AnyEvent, DetectAnomalies } from './types';

/**
 * EVENTS.md §8: "same customer, same amount, within a short window... tune
 * the window against real pilot data, not intuition." No pilot data exists
 * yet (research/claims.csv is still all TODO), so this is a placeholder,
 * not a tuned value — findable by name so it's easy to revisit.
 */
const DUPLICATE_SUSPECTED_WINDOW_MS = 5 * 60 * 1000; // 5 minutes, untuned

function eventTimestamp(event: AnyEvent): number {
  if (event.type === 'CREDIT_GIVEN' || event.type === 'PAYMENT_RECEIVED') {
    return event.payload.occurred_at ?? event.created_at;
  }
  return event.created_at;
}

export const detectAnomalies: DetectAnomalies = (state, events) => {
  const anomalies: Anomaly[] = [];

  // A voided event no longer represents anything that happened — excluded
  // from both checks below, the same way fold.ts excludes it from balances.
  const activeEvents = events.filter((event) => !state.voided.has(event.id));

  // NEGATIVE_BALANCE — money.ts's isNegative(), not a raw comparison on a
  // Poisha value (AGENTS.md §3.2).
  for (const [customerId, balance] of state.balances) {
    if (isNegative(balance.balance_poisha)) {
      const candidates = activeEvents.filter(
        (event) =>
          (event.type === 'CREDIT_GIVEN' || event.type === 'PAYMENT_RECEIVED') &&
          event.payload.customer_id === customerId,
      );
      anomalies.push({
        kind: 'NEGATIVE_BALANCE',
        customer_id: customerId,
        amount_poisha: balance.balance_poisha,
        candidates,
      });
    }
  }

  // DUPLICATE_SUSPECTED — scoped to PAYMENT_RECEIVED, matching EVENTS.md
  // §8's own example ("two devices... both record a ৳500 payment") and its
  // "duplicate-payment review screen" language.
  const paymentEvents = activeEvents.filter((event) => event.type === 'PAYMENT_RECEIVED');
  for (const [i, a] of paymentEvents.entries()) {
    for (const b of paymentEvents.slice(i + 1)) {
      const sameCustomer = a.payload.customer_id === b.payload.customer_id;
      const sameAmount = a.payload.amount_poisha === b.payload.amount_poisha;
      const withinWindow = Math.abs(eventTimestamp(a) - eventTimestamp(b)) <= DUPLICATE_SUSPECTED_WINDOW_MS;
      if (sameCustomer && sameAmount && withinWindow) {
        anomalies.push({ kind: 'DUPLICATE_SUSPECTED', events: [a, b] });
      }
    }
  }

  return anomalies;
};
