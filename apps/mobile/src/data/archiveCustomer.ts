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
import type { AnyEvent, CustomerArchiveReason } from '@hisab/domain';
import type { EventStore } from './eventStore';
import type { Database, SqlRow } from './db';

interface EventRow extends SqlRow {
  id: string;
  device_id: string;
  seq: number;
  hlc: string;
  shop_id: string;
  type: string;
  payload: string;
  created_at: number;
  synced_at: number | null;
}

function rowToEvent(row: EventRow): AnyEvent {
  return {
    id: row.id,
    device_id: row.device_id,
    seq: row.seq,
    hlc: row.hlc,
    shop_id: row.shop_id,
    type: row.type,
    payload: JSON.parse(row.payload),
    created_at: row.created_at,
    synced_at: row.synced_at,
  } as AnyEvent;
}

export type ArchiveCustomerResult =
  | { readonly kind: 'OK' }
  | { readonly kind: 'UNKNOWN_CUSTOMER' }
  | { readonly kind: 'VALIDATION_ERROR' };

export async function archiveCustomer(
  db: Database,
  store: EventStore,
  customerId: string,
  reason: CustomerArchiveReason,
): Promise<ArchiveCustomerResult> {
  const rows = await db.getAllAsync<EventRow>(
    `SELECT id, device_id, seq, hlc, shop_id, type, payload, created_at, synced_at
       FROM events WHERE json_extract(payload, '$.customer_id') = ?`,
    [customerId],
  );
  const state = fold(rows.map(rowToEvent));

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
