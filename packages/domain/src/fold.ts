// fold.ts — AGENTS.md §3.1. fold(events) => LedgerState.
//
// Scoped to the SIX core events (EVENTS.md §3): CUSTOMER_ADDED,
// CUSTOMER_RENAMED, CUSTOMER_ARCHIVED, CREDIT_GIVEN, PAYMENT_RECEIVED,
// ENTRY_VOIDED. Every other event type falls through the switch below and is
// silently skipped — not stubbed, not folded. Product/stock folding is
// Step 12; `products`, `stock`, and `pendingProductIds` are always empty here.
//
// Zero I/O (AGENTS.md §3.1): no Date, no randomness, no platform access.
// Balance arithmetic goes through money.ts's add/subtract exclusively
// (AGENTS.md §3.2) — enforced by this file also being covered by
// eslint.config.js's poishaArithmeticGuard.

import { add, subtract } from './money';
import type {
  AnyEvent,
  BalanceState,
  CustomerState,
  Fold,
  LedgerState,
  Poisha,
} from './types';

/**
 * EVENTS.md §1 invariant 3: "Ordering is by hlc, then device_id as a
 * tiebreak." fold() sorts internally rather than trusting the caller, so
 * order-independence is a property of the function, not an assumption about
 * its input.
 */
function compareByHlc(a: AnyEvent, b: AnyEvent): number {
  if (a.hlc < b.hlc) return -1;
  if (a.hlc > b.hlc) return 1;
  if (a.device_id < b.device_id) return -1;
  if (a.device_id > b.device_id) return 1;
  return 0;
}

/**
 * Every `voids_event_id` referenced by any `ENTRY_VOIDED` in the log, from a
 * full scan independent of processing order. Using a Set makes two
 * `ENTRY_VOIDED`s for the same target collapse to one automatically — that is
 * the idempotency guarantee (EVENTS.md §3), not a separate check.
 */
function collectVoidedIds(events: readonly AnyEvent[]): ReadonlySet<string> {
  const voided = new Set<string>();
  for (const event of events) {
    if (event.type === 'ENTRY_VOIDED') {
      voided.add(event.payload.voids_event_id);
    }
  }
  return voided;
}

/**
 * `last_activity_at` is the max of `occurred_at ?? created_at` seen so far,
 * not "whichever event was processed last" — a backdated entry processed
 * later in hlc order must not regress a customer's last-activity time.
 */
function applyBalanceDelta(
  balances: Map<string, BalanceState>,
  customerId: string,
  amount: Poisha,
  op: 'add' | 'subtract',
  occurredAt: number | null,
  createdAt: number,
): void {
  const existing: BalanceState = balances.get(customerId) ?? {
    customer_id: customerId,
    balance_poisha: 0 as Poisha,
    last_activity_at: null,
  };
  const balance_poisha =
    op === 'add' ? add(existing.balance_poisha, amount) : subtract(existing.balance_poisha, amount);
  const effectiveTime = occurredAt ?? createdAt;
  const last_activity_at =
    existing.last_activity_at === null || effectiveTime > existing.last_activity_at
      ? effectiveTime
      : existing.last_activity_at;
  balances.set(customerId, { customer_id: customerId, balance_poisha, last_activity_at });
}

export const fold: Fold = (events) => {
  const sorted = [...events].sort(compareByHlc);
  const voided = collectVoidedIds(sorted);

  const customers = new Map<string, CustomerState>();
  const balances = new Map<string, BalanceState>();
  const pendingCustomerIds = new Set<string>();

  for (const event of sorted) {
    const isVoided = event.type !== 'ENTRY_VOIDED' && voided.has(event.id);

    if (!isVoided) {
      switch (event.type) {
        case 'CUSTOMER_ADDED': {
          const { customer_id, display_name, phone } = event.payload;
          customers.set(customer_id, { id: customer_id, display_name, phone, archived: false });
          break;
        }
        case 'CUSTOMER_RENAMED': {
          const existing = customers.get(event.payload.customer_id);
          if (!existing) break; // unknown customer — nothing to rename
          customers.set(existing.id, {
            ...existing,
            display_name: event.payload.display_name,
            // omitted `phone` = leave unchanged; explicit null = clear it (EVENTS.md §2)
            phone: event.payload.phone === undefined ? existing.phone : event.payload.phone,
          });
          break;
        }
        case 'CUSTOMER_ARCHIVED': {
          const existing = customers.get(event.payload.customer_id);
          if (!existing) break;
          customers.set(existing.id, { ...existing, archived: true });
          break;
        }
        case 'CREDIT_GIVEN':
          applyBalanceDelta(
            balances,
            event.payload.customer_id,
            event.payload.amount_poisha,
            'add',
            event.payload.occurred_at,
            event.created_at,
          );
          break;
        case 'PAYMENT_RECEIVED':
          applyBalanceDelta(
            balances,
            event.payload.customer_id,
            event.payload.amount_poisha,
            'subtract',
            event.payload.occurred_at,
            event.created_at,
          );
          break;
        case 'ENTRY_VOIDED':
          break; // its effect is entirely captured by collectVoidedIds above
        default:
          break; // not folded here — Step 12 (product/stock) or a later phase
      }
    }

    // Sync-pending bookkeeping is independent of voided status: a voided
    // write still needs to reach the server, same as any other local write.
    // Scoped to the same six event types on purpose — this is not product
    // sync tracking.
    if (event.synced_at === null) {
      switch (event.type) {
        case 'CUSTOMER_ADDED':
        case 'CUSTOMER_RENAMED':
        case 'CUSTOMER_ARCHIVED':
        case 'CREDIT_GIVEN':
        case 'PAYMENT_RECEIVED':
          pendingCustomerIds.add(event.payload.customer_id);
          break;
        default:
          break;
      }
    }
  }

  return {
    customers,
    balances,
    products: new Map(),
    stock: new Map(),
    voided,
    pendingCustomerIds,
    pendingProductIds: new Set(),
  };
};
