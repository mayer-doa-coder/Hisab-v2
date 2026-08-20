// archiveCustomer.ts — the data-layer wiring for CUSTOMER_ARCHIVED. Step 11
// audit item 7: `applyArchiveCustomer` (packages/domain/src/commands.ts) did
// not exist until this step, and neither did anything that calls it.
//
// A REAL GAP FOUND WHILE WIRING THIS, WORTH FLAGGING RATHER THAN PAPERING
// OVER: eventStore.append() calls @hisab/domain's buildEvent() directly for
// every event type — it does NOT call applyCredit/applyPayment/
// applyCorrection. Those three command functions exist, are tested, and
// have real business checks (e.g. applyCredit's AMOUNT_NOT_POSITIVE), but
// nothing in the actual device write path invokes them; only buildEvent's
// structural Zod validation runs. For CREDIT_GIVEN/PAYMENT_RECEIVED this is
// mostly harmless by coincidence — buildEvent's own Zod schema already
// requires a positive integer amount, duplicating applyCredit's check. For
// CUSTOMER_ARCHIVED it is NOT harmless: "does this customer_id exist" is not
// a Zod-expressible, stateless check, so applyArchiveCustomer's UNKNOWN_CUSTOMER
// rule is the ONLY place that exists, and it is not reachable through
// eventStore.append() the way every other event's write path works today.
// This is a pre-existing architecture gap spanning all four command
// functions, not something specific to archiving — fixing it properly means
// deciding whether eventStore.append() should route through commands.ts for
// every type, which touches CREDIT_GIVEN/PAYMENT_RECEIVED/ENTRY_VOIDED too
// and is out of this step's scope. Flagged in this step's report, not
// silently fixed here.
//
// So: this file does the one-line equivalent check directly against the
// SAME state.customers map applyArchiveCustomer reads (not a reimplemented
// business rule — a single map lookup), then calls store.append() the same
// way every other screen in this codebase already writes an event.

import { fold } from '@hisab/domain';
import type { CustomerArchiveReason } from '@hisab/domain';
import type { EventStore } from './eventStore';

export type ArchiveCustomerResult =
  | { readonly kind: 'OK' }
  | { readonly kind: 'UNKNOWN_CUSTOMER' }
  | { readonly kind: 'VALIDATION_ERROR' };

export async function archiveCustomer(
  store: EventStore,
  customerId: string,
  reason: CustomerArchiveReason,
): Promise<ArchiveCustomerResult> {
  // FIXED — found during a whole-project audit: this used to hand-roll the
  // exact same query eventStore.ts's own getEventsForCustomer already runs
  // internally (down to the identical ENTRY_VOIDED-targeting-CUSTOMER_ADDED
  // clause, added here after being found missing — see the removed
  // comment's history). Two copies of a query that was once subtly wrong is
  // exactly how that class of bug recurs: eventsForCustomer is now exposed
  // on EventStore precisely so callers like this one don't need their own
  // copy — added to the interface once CustomerDetailScreen needed it too,
  // which is the same query, needed by a second caller, that should have
  // been surfaced instead of duplicated the first time.
  const events = await store.eventsForCustomer(customerId);
  const state = fold(events);

  if (!state.customers.has(customerId)) {
    return { kind: 'UNKNOWN_CUSTOMER' };
  }

  const result = await store.append('CUSTOMER_ARCHIVED', {
    schema_version: 1,
    customer_id: customerId,
    reason,
  });

  return 'kind' in result ? { kind: 'VALIDATION_ERROR' } : { kind: 'OK' };
}
