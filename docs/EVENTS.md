# EVENTS.md — the event catalogue

**Owner:** A · **Status:** contract — changes require both team members to agree

This is the authoritative list of every event type in Hisab. The event log is the source of truth; everything else in the system is derived from it. If it isn't in this file, it isn't an event.

---

## 1. The envelope

Every event, regardless of type, has this shape:

```ts
interface Event<T extends EventType = EventType> {
  id: string;            // UUIDv7, generated on-device. Also the idempotency key.
  device_id: string;     // which device created it
  seq: number;           // monotonic per device, starts at 1, never reused
  hlc: string;           // hybrid logical clock — the ordering key
  shop_id: string;
  type: T;
  payload: PayloadFor<T>;
  created_at: number;    // device wall clock, epoch ms. UNTRUSTED — display only.
  synced_at: number | null;  // null = not yet pushed to server
}
```

SQLite schema:

```sql
CREATE TABLE events (
  id          TEXT PRIMARY KEY,
  device_id   TEXT    NOT NULL,
  seq         INTEGER NOT NULL,
  hlc         TEXT    NOT NULL,
  shop_id     TEXT    NOT NULL,
  type        TEXT    NOT NULL,
  payload     TEXT    NOT NULL,     -- JSON
  created_at  INTEGER NOT NULL,
  synced_at   INTEGER,
  UNIQUE (device_id, seq)
);
CREATE INDEX idx_events_hlc      ON events (hlc);
CREATE INDEX idx_events_unsynced ON events (synced_at) WHERE synced_at IS NULL;
```

### Invariants

1. **Append-only.** `INSERT` only. No `UPDATE`, no `DELETE`, no soft-delete column on this table. Enforced by a trigger and by a test.
2. **`created_at` is untrusted.** Device clocks are wrong, sometimes by years. Use it for display; use `hlc` for ordering; use the server's receipt time for anything that must be authoritative.
3. **Ordering is by `hlc`, then `device_id` as a tiebreak.** This makes the fold deterministic across devices.
4. **Every payload carries `schema_version`.** Starting at 1, from the very first event ever written. Migrations upcast old payloads at read time; they never rewrite stored events.
5. **Payloads are small and self-contained.** No references to mutable state elsewhere. An event must be interpretable years later without any other context.
6. **Payloads are validated by a Zod schema** on write (client) and on receipt (server). An event failing validation is rejected, never stored.

---

## 2. Money and quantity in payloads

- Every monetary field ends in `_poisha` and is an integer. 1 BDT = 100 poisha.
- Every quantity field ends in `_units` or carries an explicit `unit` field.
- Never a float. Never a formatted string.

---

## 3. Core events — Phase 1 and 2

These six carry the entire core product. Build these first and nothing else.

### `CUSTOMER_ADDED`

```ts
{
  schema_version: 1,
  customer_id: string,      // UUIDv7, generated on-device
  display_name: string,     // the nickname — what the shopkeeper calls them. REQUIRED.
  phone: string | null,     // optional, E.164 or local format as typed
}
```

`display_name` is the only required field. Not legal name, not address, not credit limit, not due terms. Shopkeepers know customers as "রহিম ভাই", "chairman shaheb", "the tailor". See `AGENTS.md` §8 on data minimisation.

### `CUSTOMER_RENAMED`

```ts
{ schema_version: 1, customer_id: string, display_name: string, phone?: string | null }
```

Corrects a typo or updates a nickname. The old value stays in the log.

### `CUSTOMER_ARCHIVED`

```ts
{ schema_version: 1, customer_id: string, reason: 'DUPLICATE' | 'INACTIVE' | 'REQUESTED' }
```

Hides a customer from lists. Never deletes their history. `reason: 'REQUESTED'` is the data-subject-erasure path — see `docs/SECURITY.md`.

### `CREDIT_GIVEN` — বাকি

```ts
{
  schema_version: 1,
  entry_id: string,
  customer_id: string,
  amount_poisha: number,       // positive integer
  note: string | null,
  occurred_at: number | null,  // if backdated by the user; null means "now"
}
```

The single most important event in the system. Everything in the credit-entry flow exists to produce this in under 8 seconds.

### `PAYMENT_RECEIVED` — জমা

```ts
{
  schema_version: 1,
  entry_id: string,
  customer_id: string,
  amount_poisha: number,       // positive integer
  note: string | null,
  occurred_at: number | null,
}
```

Note there is **no `applies_to_entry_id`.** Payments are against the running balance, not against specific credit entries. Shopkeepers do not track which taka pays off which purchase, and forcing that model creates reconciliation work that has no counterpart in reality. If field research contradicts this, change it here first and record it in `DECISIONS.md`.

### `ENTRY_VOIDED`

```ts
{
  schema_version: 1,
  voids_event_id: string,       // the id of the CREDIT_GIVEN or PAYMENT_RECEIVED being voided
  reason: 'MISTAKE' | 'DUPLICATE' | 'DISPUTED',
}
```

The only way to undo anything. The original event is never removed; the fold skips events that a later `ENTRY_VOIDED` references. This is what the 10-second undo affordance emits, and what the duplicate-payment review screen emits.

Voiding is idempotent: two `ENTRY_VOIDED` events for the same target have the same effect as one. There is a property test for this.

---

## 4. Inventory events — Phase 4

Do not build these until the six core screens have been in a real shop for two weeks.

### `PRODUCT_ADDED`

```ts
{
  schema_version: 1,
  product_id: string,
  name: string,
  unit: 'PIECE' | 'KG' | 'GRAM' | 'LITRE' | 'ML' | 'PACKET' | 'DOZEN',
  sale_price_poisha: number | null,
  low_stock_threshold_units: number | null,
}
```

**No `quantity` field.** Stock is a fold over movement events. v1 stored `Product.quantity` and `InventoryBatch.quantity` separately and needed a `validateInventoryBatchConsistency` function because the two drifted. Do not reintroduce this.

**No `expiry_date` field either** — expiry belongs to a batch received on a date, not to the product type. Same reason.

### `PRODUCT_UPDATED`

```ts
{ schema_version: 1, product_id: string, name?, unit?, sale_price_poisha?, low_stock_threshold_units? }
```

### `PRODUCT_ARCHIVED`

```ts
{ schema_version: 1, product_id: string }
```

### `STOCK_RECEIVED`

```ts
{
  schema_version: 1,
  movement_id: string,
  product_id: string,
  quantity_units: number,          // positive
  cost_price_poisha: number | null,
  expiry_date: string | null,      // ISO date, on the batch not the product
  occurred_at: number | null,
}
```

### `STOCK_SOLD`

```ts
{
  schema_version: 1,
  movement_id: string,
  product_id: string,
  quantity_units: number,          // positive; the fold subtracts
  sale_price_poisha: number,
  sale_id: string | null,          // links line items of one sale
  occurred_at: number | null,
}
```

### `STOCK_ADJUSTED`

```ts
{
  schema_version: 1,
  movement_id: string,
  product_id: string,
  delta_units: number,             // signed — can be negative
  reason: 'DAMAGE' | 'EXPIRY' | 'COUNT_CORRECTION' | 'GIFT' | 'OTHER',
  note: string | null,
}
```

### `SALE_RECORDED`

```ts
{
  schema_version: 1,
  sale_id: string,
  customer_id: string | null,      // null = walk-in cash sale
  total_poisha: number,
  payment_method: 'CASH' | 'CREDIT' | 'MIXED',
  cash_paid_poisha: number,        // remainder becomes credit
  occurred_at: number | null,
}
```

A `MIXED` or `CREDIT` sale emits both a `SALE_RECORDED` and a `CREDIT_GIVEN` in the same batch, sharing `occurred_at`. The domain layer produces both from one command; the UI never emits two separately.

---

## 5. Configuration events — Phase 5

### `SEASONAL_MULTIPLIER_SET`

```ts
{
  schema_version: 1,
  product_id: string | null,       // null = applies to all products
  season: 'RAMADAN' | 'EID_UL_FITR' | 'EID_UL_ADHA' | 'MONSOON' | 'HARVEST',
  multiplier: number,              // e.g. 2.0 — set by the shopkeeper, not learned
}
```

This is deliberately shopkeeper-editable rather than a hidden model weight. The shopkeeper knows Eid demand better than the model does. **Log what they choose** — it is data nobody else has, and it is a genuine research output.

### `REORDER_SETTINGS_SET`

```ts
{
  schema_version: 1,
  product_id: string | null,
  lead_time_days: number | null,
  service_level: number | null,    // 0..1
}
```

---

## 6. Deliberately not events

| Not an event | Why |
|---|---|
| `BALANCE_UPDATED` | Balance is a fold. Storing it is the v1 bug. |
| `RISK_SCORE_COMPUTED` | Derived, and recomputed from the log every time. Never persisted. |
| `SYNC_COMPLETED` | Sync state lives in a local table, not the ledger. It is device-local and must not replicate. |
| `USER_LOGGED_IN` | Auth is not ledger data. Security events go to a separate local log. |
| Anything about another shop | See `AGENTS.md` §4.7. |

---

## 7. Projections

Projections are derived caches, rebuilt by replaying the log. They may be dropped at any time.

| Table | Derived from | Key columns |
|---|---|---|
| `customers` | `CUSTOMER_*` | `id`, `display_name`, `phone`, `archived` |
| `balances` | `CREDIT_GIVEN`, `PAYMENT_RECEIVED`, `ENTRY_VOIDED` | `customer_id`, `balance_poisha`, `last_activity_at` |
| `products` | `PRODUCT_*` | `id`, `name`, `unit`, `sale_price_poisha` |
| `stock` | `STOCK_*` | `product_id`, `quantity_units`, `earliest_expiry` |
| `daily_sales` | `STOCK_SOLD` | `product_id`, `date`, `quantity_units` — feeds the forecaster |

**Rebuild test (must always pass):** drop every projection table, replay the full log, and assert the resulting state is identical to the state before the drop. This test is the guarantee that projections never become a second source of truth.

---

## 8. Anomalies

Genuine semantic conflicts are not prevented — they are detected after the fold and surfaced to the shopkeeper, who knows what actually happened.

```ts
type Anomaly =
  | { kind: 'NEGATIVE_BALANCE'; customer_id: string; amount_poisha: number; candidates: Event[] }
  | { kind: 'NEGATIVE_STOCK';   product_id: string;  quantity_units: number; candidates: Event[] }
  | { kind: 'DUPLICATE_SUSPECTED'; events: [Event, Event] };
```

Example: two devices are offline and both record a ৳500 payment against a ৳500 balance. Both events are individually valid; together they overpay. The fold produces a negative balance, `detectAnomalies` catches it, and the review screen shows both entries side by side with one tap to void one.

**Anomaly detection never blocks a write.** The shopkeeper is at a counter; the app records what they say happened and reconciles afterwards. `DUPLICATE_SUSPECTED` uses same customer + same amount + within a short window as the heuristic; tune the window against real pilot data, not intuition.

---

## 9. Adding a new event type

Checklist. All six, in one PR. (This checklist is duplicated as a single checkbox in `.github/pull_request_template.md` — that's the mechanical enforcement; this is the authoritative detail.)

1. Entry in this file, with the payload interface and the rationale
2. Zod schema in `packages/domain/src/events.ts`
3. Case in `fold.ts`
4. Unit test, plus a property test if it affects money
5. Projection update, and the rebuild test still passing
6. Entry in `docs/DECISIONS.md`

If you cannot explain in one sentence why an existing event can't represent the thing, don't add a new type.

---

## 10. Schema evolution

Stored events are never rewritten. Old payloads are upcast at read time:

```ts
function upcast(type: EventType, payload: unknown): CurrentPayload {
  const v = (payload as { schema_version: number }).schema_version;
  switch (type) {
    case 'CREDIT_GIVEN':
      // v1 → v2 example: v2 added `occurred_at`; v1 events fall back to created_at
      return v === 1 ? { ...payload, schema_version: 2, occurred_at: null } : payload;
    default:
      return payload;
  }
}
```

Rules: new fields are optional or have a defined default; fields are never removed, only deprecated and ignored; the meaning of an existing field never changes — if the meaning changes, it is a new field.
