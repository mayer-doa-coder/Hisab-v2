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

/**
 * `synced_at` is DERIVED, never read straight off the events row.
 *
 * `events.synced_at` is written at INSERT time only — null for a local write,
 * the server's `received_at` for an event pulled from the server. The
 * transition "a local event has now been pushed" lives in the device-local
 * `sync_state` table, because the events table is INSERT-only (EVENTS.md §1
 * invariant 1) and an `UPDATE events SET synced_at` is both forbidden by that
 * invariant and blocked by eslint.config.js. COALESCE collapses the two into
 * one effective value here, in one place. See schema.ts and DECISIONS.md
 * 2026-08-15.
 */
const EVENT_COLUMNS = `e.id, e.device_id, e.seq, e.hlc, e.shop_id, e.type, e.payload,
       e.created_at, COALESCE(e.synced_at, s.synced_at) AS synced_at`;
const EVENT_SOURCE = 'FROM events e LEFT JOIN sync_state s ON s.event_id = e.id';

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

/** One event that arrived from the server, envelope intact. */
export interface RemoteEvent {
  readonly id: string;
  readonly device_id: string;
  readonly seq: number;
  readonly hlc: string;
  readonly shop_id: string;
  readonly type: string;
  readonly payload: unknown;
  readonly created_at: number;
  readonly received_at: number;
}

export interface MergeResult {
  readonly inserted: number;
  /** Already present locally — the normal case for this device's own events coming back. */
  readonly duplicates: number;
  readonly rejected: readonly ValidationError[];
}

export interface EventStore {
  append(type: EventType, payload: unknown): Promise<AnyEvent | ValidationError>;
  since(seq: number): Promise<AnyEvent[]>;
  rebuildProjections(): Promise<void>;

  // ---- sync (Step 10) -------------------------------------------------------
  /** Every event this device holds that the server has not confirmed. */
  unsynced(): Promise<AnyEvent[]>;
  /** Records that the server now holds these ids. Writes sync_state, never UPDATEs events. */
  markPushed(ids: readonly string[], syncedAt: number): Promise<void>;
  /** Inserts remote events verbatim, idempotently, and re-folds what they touch. */
  merge(events: readonly RemoteEvent[]): Promise<MergeResult>;
  /** Highest server_seq merged so far; 0 if this device has never pulled. */
  getCursor(): Promise<number>;
  setCursor(serverSeq: number): Promise<void>;
  /** Every event, for a full fold. Used by the convergence test and by rebuilds. */
  allEvents(): Promise<AnyEvent[]>;
  /**
   * Every event touching one customer: direct references plus ENTRY_VOIDEDs
   * targeting them. Surfaces the same query append()/writeProjection() already
   * use internally — CustomerDetailScreen (Step 14) needs the raw events to
   * build a running-balance history via @hisab/domain's customerHistory(),
   * which is a different shape from the customers/balances projection.
   */
  eventsForCustomer(customerId: string): Promise<AnyEvent[]>;
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
      `SELECT ${EVENT_COLUMNS} ${EVENT_SOURCE}
       WHERE json_extract(e.payload, '$.customer_id') = ?
          OR (e.type = 'ENTRY_VOIDED' AND json_extract(e.payload, '$.voids_event_id') IN (
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
        `SELECT ${EVENT_COLUMNS} ${EVENT_SOURCE} WHERE e.device_id = ? AND e.seq > ? ORDER BY e.seq ASC`,
        [deviceId, seq],
      );
      return rows.map(rowToEvent);
    },

    async allEvents() {
      const rows = await db.getAllAsync<EventRow>(`SELECT ${EVENT_COLUMNS} ${EVENT_SOURCE}`, []);
      return rows.map(rowToEvent);
    },

    async eventsForCustomer(customerId) {
      return getEventsForCustomer(customerId);
    },

    async unsynced() {
      // Both halves of the derived value matter here: `e.synced_at IS NULL`
      // excludes events that arrived from the server (already there by
      // definition), and the missing sync_state row is what marks a local
      // write as still pending.
      const rows = await db.getAllAsync<EventRow>(
        `SELECT ${EVENT_COLUMNS} ${EVENT_SOURCE}
         WHERE e.synced_at IS NULL AND s.event_id IS NULL
         ORDER BY e.hlc ASC, e.device_id ASC`,
        [],
      );
      return rows.map(rowToEvent);
    },

    async markPushed(ids, syncedAt) {
      for (const id of ids) {
        // INSERT OR REPLACE, not UPDATE events — the ledger table is never
        // written after the fact (EVENTS.md §1 invariant 1).
        await db.runAsync('INSERT OR REPLACE INTO sync_state (event_id, synced_at) VALUES (?, ?)', [
          id,
          syncedAt,
        ]);
      }
    },

    async merge(remoteEvents) {
      const rejected: ValidationError[] = [];
      const touchedCustomers = new Set<string>();
      let inserted = 0;
      let duplicates = 0;

      for (const remote of remoteEvents) {
        // Validation is not reimplemented for the inbound direction:
        // buildEvent runs the same Zod schemas as a local write, with the
        // remote envelope passed straight through as ctx. What comes back is
        // the peer's event reconstructed, never restamped — its id, seq, hlc
        // and device_id are the originating device's and must stay that way,
        // or the event would no longer be the same event.
        const built = buildEvent(remote.type, remote.payload, {
          event_id: remote.id,
          device_id: remote.device_id,
          seq: remote.seq,
          hlc: remote.hlc,
          shop_id: remote.shop_id,
          created_at: remote.created_at,
        });

        if ('kind' in built) {
          rejected.push(built);
          continue;
        }

        const existing = await db.getAllAsync<{ id: string }>('SELECT id FROM events WHERE id = ?', [
          remote.id,
        ]);
        if (existing.length > 0) {
          // This device's own event coming back to it. Idempotent by
          // construction: the id is the device-generated UUID (AGENTS.md §7),
          // so no dedup table is needed on either side.
          duplicates += 1;
          // It has demonstrably reached the server, so record that.
          await db.runAsync('INSERT OR REPLACE INTO sync_state (event_id, synced_at) VALUES (?, ?)', [
            remote.id,
            remote.received_at,
          ]);
          continue;
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
            // Written at INSERT time, which is the only time events rows are
            // ever written. It came from the server, so it is synced by
            // definition — no sync_state row is needed for it.
            remote.received_at,
          ],
        );
        inserted += 1;

        // Move the local clock past what we have now seen, so the next event
        // this device writes sorts after it (clock.ts's tickReceive).
        clock.receive(built.hlc);

        const customerId = await resolveCustomerId(built);
        if (customerId !== null) touchedCustomers.add(customerId);
      }

      // Re-fold once per affected customer, after the whole batch — folding
      // per-event would do the same work N times for a customer with N
      // incoming events.
      for (const customerId of touchedCustomers) {
        await writeProjection(customerId, fold(await getEventsForCustomer(customerId)));
      }

      return { inserted, duplicates, rejected };
    },

    async getCursor() {
      const rows = await db.getAllAsync<{ server_seq: number }>(
        'SELECT server_seq FROM sync_cursor WHERE id = 1',
        [],
      );
      return rows[0]?.server_seq ?? 0;
    },

    async setCursor(serverSeq) {
      await db.runAsync(
        `INSERT INTO sync_cursor (id, server_seq) VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET server_seq = excluded.server_seq`,
        [serverSeq],
      );
    },

    async rebuildProjections() {
      await db.runAsync('DELETE FROM customers', []);
      await db.runAsync('DELETE FROM balances', []);

      const rows = await db.getAllAsync<EventRow>(`SELECT ${EVENT_COLUMNS} ${EVENT_SOURCE}`, []);
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
