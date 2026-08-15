// eventStore.ts — append(), since(), rebuildProjections().
//
// Validation is never reimplemented here: append() calls @hisab/domain's
// buildEvent() (Step 4/9's new export) for both envelope assembly and Zod
// validation. Balance updates are re-folds, never in-place SQL increments
// (AGENTS.md §3.3) — after a write, the affected customer's events are
// re-read from SQLite and folded via @hisab/domain's fold(), and the
// projection row is overwritten with that result. The projection is always
// a cache of a fold; it is never computed any other way.
//
// device_id/hlc/created_at/id/seq are stamped here, not inside
// packages/domain — that package has zero I/O and cannot read a clock or
// generate a random id.

import { buildEvent, fold } from '@hisab/domain';
import type { AnyEvent, EventType, LedgerState, ValidationError } from '@hisab/domain';
import type { Clock } from './clock';
import type { Database, SqlRow } from './db';
import { uuidv7, type GetRandomBytes } from './uuid';

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

/** Only five of fifteen payload types carry customer_id directly (§3's core five). */
function directCustomerId(payload: unknown): string | null {
  const record = payload as Record<string, unknown>;
  return typeof record.customer_id === 'string' ? record.customer_id : null;
}

function voidsEventId(payload: unknown): string | null {
  const record = payload as Record<string, unknown>;
  return typeof record.voids_event_id === 'string' ? record.voids_event_id : null;
}

export interface EventStoreConfig {
  readonly db: Database;
  readonly deviceId: string;
  readonly shopId: string;
  readonly clock: Clock;
  readonly getRandomBytes: GetRandomBytes;
  readonly now?: () => number;
}

export interface EventStore {
  append(type: EventType, payload: unknown): Promise<AnyEvent | ValidationError>;
  since(seq: number): Promise<AnyEvent[]>;
  rebuildProjections(): Promise<void>;
}

export function createEventStore(config: EventStoreConfig): EventStore {
  const { db, deviceId, shopId, clock, getRandomBytes } = config;
  const now = config.now ?? Date.now;

  // A queue, not a cached number-plus-lazy-init: two append() calls in quick
  // succession (a rapid double-tap on the highest-frequency action in the
  // app) can both reach `nextSeq()` before either's DB read resolves. A
  // naive `if (cached === null) { cached = await read() }` lets both calls
  // see `null`, both read the same MAX(seq), and both return the same
  // value — a real, reproduced bug (two concurrent calls returned seq=1
  // for the same device), which then collides on `UNIQUE(device_id, seq)`.
  // Chaining onto a single promise serializes every call, concurrent or
  // not, through one line of resolution order.
  let seqChain: Promise<number> = db
    .getAllAsync<{ maxSeq: number | null }>('SELECT MAX(seq) as maxSeq FROM events WHERE device_id = ?', [deviceId])
    .then((rows) => rows[0]?.maxSeq ?? 0);

  function nextSeq(): Promise<number> {
    seqChain = seqChain.then((current) => current + 1);
    return seqChain;
  }

  /** Resolves which customer's projection is affected by one newly-written event. */
  async function resolveCustomerId(event: AnyEvent): Promise<string | null> {
    const direct = directCustomerId(event.payload);
    if (direct !== null) return direct;

    const targetId = voidsEventId(event.payload);
    if (targetId === null) return null;

    const rows = await db.getAllAsync<EventRow>('SELECT * FROM events WHERE id = ?', [targetId]);
    const target = rows[0];
    return target ? directCustomerId(JSON.parse(target.payload)) : null;
  }

  /** All events touching one customer: direct references plus ENTRY_VOIDEDs targeting them. */
  async function getEventsForCustomer(customerId: string): Promise<AnyEvent[]> {
    const rows = await db.getAllAsync<EventRow>(
      `SELECT * FROM events
       WHERE json_extract(payload, '$.customer_id') = ?
          OR (type = 'ENTRY_VOIDED' AND json_extract(payload, '$.voids_event_id') IN (
                SELECT id FROM events WHERE json_extract(payload, '$.customer_id') = ?
              ))`,
      [customerId, customerId],
    );
    return rows.map(rowToEvent);
  }

  /**
   * Overwrites the customer/balance projection rows with a fresh fold
   * result — including DELETING a row when the fold no longer produces one.
   * A customer whose only CREDIT_GIVEN gets voided folds to a customer entry
   * with no balance entry; without the delete branches below, the earlier
   * balance row would survive untouched — a stale row, the same class of
   * bug as an in-place increment, just via omission instead of arithmetic.
   * rebuildProjections() never had this bug (it starts from a clean slate),
   * which is exactly the divergence the rebuild-invariant test caught.
   */
  async function writeProjection(customerId: string, state: LedgerState): Promise<void> {
    const customer = state.customers.get(customerId);
    if (!customer) {
      // Every event for this customer is gone from the fold (e.g. the
      // CUSTOMER_ADDED itself was voided) — no valid projection exists.
      await db.runAsync('DELETE FROM customers WHERE id = ?', [customerId]);
      await db.runAsync('DELETE FROM balances WHERE customer_id = ?', [customerId]);
      return;
    }

    await db.runAsync(
      `INSERT INTO customers (id, display_name, phone, archived) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         display_name = excluded.display_name,
         phone = excluded.phone,
         archived = excluded.archived`,
      [customer.id, customer.display_name, customer.phone, customer.archived ? 1 : 0],
    );

    const balance = state.balances.get(customerId);
    if (balance) {
      await db.runAsync(
        `INSERT INTO balances (customer_id, balance_poisha, last_activity_at) VALUES (?, ?, ?)
         ON CONFLICT(customer_id) DO UPDATE SET
           balance_poisha = excluded.balance_poisha,
           last_activity_at = excluded.last_activity_at`,
        [customerId, balance.balance_poisha, balance.last_activity_at],
      );
    } else {
      await db.runAsync('DELETE FROM balances WHERE customer_id = ?', [customerId]);
    }
  }

  return {
    async append(type, payload) {
      const seq = await nextSeq();
      const hlc = clock.next();
      const createdAt = now();

      const built = buildEvent(type, payload, {
        event_id: uuidv7(createdAt, getRandomBytes),
        device_id: deviceId,
        seq,
        hlc,
        shop_id: shopId,
        created_at: createdAt,
      });

      if ('kind' in built) {
        return built; // ValidationError — nothing written, matching buildEvent's contract
      }

      await db.runAsync(
        `INSERT INTO events (id, device_id, seq, hlc, shop_id, type, payload, created_at, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          built.id,
          built.device_id,
          built.seq,
          built.hlc,
          built.shop_id,
          built.type,
          JSON.stringify(built.payload),
          built.created_at,
          built.synced_at,
        ],
      );

      // Re-fold, never an in-place increment (AGENTS.md §3.3) — bounded to
      // the one customer this event touches, not the whole log.
      const customerId = await resolveCustomerId(built);
      if (customerId !== null) {
        const events = await getEventsForCustomer(customerId);
        await writeProjection(customerId, fold(events));
      }

      return built;
    },

    async since(seq) {
      const rows = await db.getAllAsync<EventRow>(
        'SELECT * FROM events WHERE device_id = ? AND seq > ? ORDER BY seq ASC',
        [deviceId, seq],
      );
      return rows.map(rowToEvent);
    },

    async rebuildProjections() {
      await db.runAsync('DELETE FROM customers', []);
      await db.runAsync('DELETE FROM balances', []);

      const rows = await db.getAllAsync<EventRow>('SELECT * FROM events', []);
      const allEvents = rows.map(rowToEvent);
      const byId = new Map(allEvents.map((e) => [e.id, e]));

      const byCustomer = new Map<string, AnyEvent[]>();
      for (const event of allEvents) {
        let customerId = directCustomerId(event.payload);
        if (customerId === null) {
          const targetId = voidsEventId(event.payload);
          const target = targetId !== null ? byId.get(targetId) : undefined;
          customerId = target ? directCustomerId(target.payload) : null;
        }
        if (customerId === null) continue;
        const bucket = byCustomer.get(customerId) ?? [];
        bucket.push(event);
        byCustomer.set(customerId, bucket);
      }

      for (const [customerId, events] of byCustomer) {
        await writeProjection(customerId, fold(events));
      }
    },
  };
}
