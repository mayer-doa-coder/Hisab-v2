// customerQueries.ts — read-only queries backing the six core screens'
// customer list, home total, recent activity, and customer detail header.
//
// Reads go straight against the `customers`/`balances` projection tables
// (schema.ts) rather than re-folding the log — that is what a projection is
// for. eventStore.ts's own writeProjection() is what keeps them correct
// after every append(); nothing here recomputes a balance.
//
// ZERO money arithmetic in TypeScript here (AGENTS.md §3.2): the one total
// this file computes goes through @hisab/domain's sumPoisha, the same
// operation apps/mobile/src/data/screenViewmodels.ts already uses for the
// aging total, not a SQL SUM() or a `+=` loop.

import { sumPoisha } from '@hisab/domain';
import type { Poisha, ViewModelFormatter } from '@hisab/domain';
import type { Database, SqlRow } from './db';
import { toCustomerRowVM, type CustomerProjectionRow } from './viewmodels';
import type { CustomerRowVM } from '../viewmodels/customer';
import type { HomeVM, RecentActivityRowVM } from '../viewmodels/screens';

interface UnsyncedRow extends SqlRow {
  customer_id: string | null;
}

async function unsyncedCustomerIds(db: Database): Promise<Set<string>> {
  const rows = await db.getAllAsync<UnsyncedRow>(
    `SELECT DISTINCT json_extract(e.payload, '$.customer_id') AS customer_id
       FROM events e LEFT JOIN sync_state s ON s.event_id = e.id
      WHERE e.synced_at IS NULL AND s.event_id IS NULL
        AND json_extract(e.payload, '$.customer_id') IS NOT NULL`,
    [],
  );
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.customer_id !== null) ids.add(row.customer_id);
  }
  return ids;
}

interface CustomerListRow extends SqlRow {
  id: string;
  display_name: string;
  phone: string | null;
  balance_poisha: number | null;
  last_activity_at: number | null;
}

/** Recent-first (UI_SPEC screen 2: "Recent-first, not alphabetical"), non-archived. */
export async function listCustomerRows(
  db: Database,
  now: number,
  format: ViewModelFormatter,
): Promise<CustomerRowVM[]> {
  const rows = await db.getAllAsync<CustomerListRow>(
    `SELECT c.id, c.display_name, c.phone, b.balance_poisha, b.last_activity_at
       FROM customers c LEFT JOIN balances b ON b.customer_id = c.id
      WHERE c.archived = 0
      ORDER BY COALESCE(b.last_activity_at, 0) DESC, c.display_name ASC`,
    [],
  );
  const pending = await unsyncedCustomerIds(db);
  return rows.map((row) => toCustomerRowVM(row as CustomerProjectionRow, now, format, pending.has(row.id)));
}

/** One customer's row, for the detail screen's header. Null if archived or unknown. */
export async function getCustomerRow(
  db: Database,
  customerId: string,
  now: number,
  format: ViewModelFormatter,
): Promise<CustomerRowVM | null> {
  const rows = await db.getAllAsync<CustomerListRow>(
    `SELECT c.id, c.display_name, c.phone, b.balance_poisha, b.last_activity_at
       FROM customers c LEFT JOIN balances b ON b.customer_id = c.id
      WHERE c.id = ? AND c.archived = 0`,
    [customerId],
  );
  const row = rows[0];
  if (row === undefined) return null;
  const pending = await unsyncedCustomerIds(db);
  return toCustomerRowVM(row as CustomerProjectionRow, now, format, pending.has(row.id));
}

interface RecentActivityRow extends SqlRow {
  id: string;
  type: string;
  display_name: string | null;
  amount_poisha: number;
}

const RECENT_ACTIVITY_LIMIT = 8;

/**
 * Home's total (UI_SPEC screen 1) and recent activity. Deliberately not
 * routed through buildAgingVM — that builder also orders/caps an attention
 * list Home has no use for; Home needs one number and a short recent list.
 */
export async function getHomeVM(db: Database, format: ViewModelFormatter): Promise<HomeVM> {
  const balanceRows = await db.getAllAsync<{ balance_poisha: number }>(
    'SELECT balance_poisha FROM balances WHERE balance_poisha > 0',
    [],
  );
  const total = sumPoisha(balanceRows.map((row) => row.balance_poisha as Poisha));

  const activityRows = await db.getAllAsync<RecentActivityRow>(
    `SELECT e.id, e.type, c.display_name AS display_name,
            json_extract(e.payload, '$.amount_poisha') AS amount_poisha
       FROM events e
       LEFT JOIN customers c ON c.id = json_extract(e.payload, '$.customer_id')
      WHERE e.type IN ('CREDIT_GIVEN', 'PAYMENT_RECEIVED')
        AND e.id NOT IN (
              SELECT json_extract(payload, '$.voids_event_id') FROM events WHERE type = 'ENTRY_VOIDED'
            )
      ORDER BY e.hlc DESC
      LIMIT ?`,
    [RECENT_ACTIVITY_LIMIT],
  );

  const recentActivity: RecentActivityRowVM[] = activityRows.map((row) => ({
    id: row.id,
    displayName: row.display_name ?? '',
    amountDisplay: format.money(row.amount_poisha as Poisha),
    kind: row.type === 'CREDIT_GIVEN' ? 'CREDIT' : 'PAYMENT',
  }));

  return {
    totalOwedDisplay: format.money(total),
    owedByCountDisplay: format.count(balanceRows.length),
    isEmpty: balanceRows.length === 0,
    recentActivity,
  };
}
