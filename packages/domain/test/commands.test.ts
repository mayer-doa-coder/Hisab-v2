// commands.test.ts — AGENTS.md §3.1/§3.2. Example coverage for applyCredit,
// applyPayment, applyCorrection — explicitly including the "this is NOT an
// error" cases EVENTS.md §8/§3 commit to: overpayment succeeds, double-void
// succeeds. A test suite that only covers the failing cases would silently
// let a regression turn either of those into an error later.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyArchiveCustomer, applyCorrection, applyCredit, applyPayment } from '../src/commands.ts';
import { fold } from '../src/fold.ts';
import type { AnyEvent, CommandContext, Poisha } from '../src/types.ts';

function ctx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    event_id: 'evt-x',
    device_id: 'device-a',
    seq: 1,
    hlc: '00000099',
    shop_id: 'shop-1',
    created_at: 1_700_000_000_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// applyCredit
// ---------------------------------------------------------------------------

void test('applyCredit rejects amount_poisha <= 0', () => {
  const result = applyCredit(fold([]), {
    ctx: ctx(),
    entry_id: 'e1',
    customer_id: 'c1',
    amount_poisha: 0 as Poisha,
    note: null,
    occurred_at: null,
  });
  assert.ok(!Array.isArray(result), 'a non-positive amount must be rejected');
  assert.equal(result.code, 'AMOUNT_NOT_POSITIVE');
});

void test('applyCredit produces a CREDIT_GIVEN event for a valid positive amount', () => {
  const result = applyCredit(fold([]), {
    ctx: ctx({ event_id: 'evt-credit-1' }),
    entry_id: 'e1',
    customer_id: 'c1',
    amount_poisha: 5000 as Poisha,
    note: null,
    occurred_at: null,
  });
  assert.ok(Array.isArray(result), 'a valid credit must succeed');
  assert.equal(result.length, 1);
  const event = result[0];
  assert.ok(event !== undefined);
  assert.equal(event.type, 'CREDIT_GIVEN');
  assert.equal(event.id, 'evt-credit-1');
  if (event.type === 'CREDIT_GIVEN') {
    assert.equal(event.payload.amount_poisha, 5000);
  }
});

// ---------------------------------------------------------------------------
// applyPayment
// ---------------------------------------------------------------------------

void test('applyPayment rejects amount_poisha <= 0', () => {
  const result = applyPayment(fold([]), {
    ctx: ctx(),
    entry_id: 'e1',
    customer_id: 'c1',
    amount_poisha: -100 as Poisha,
    note: null,
    occurred_at: null,
  });
  assert.ok(!Array.isArray(result), 'a non-positive amount must be rejected');
  assert.equal(result.code, 'AMOUNT_NOT_POSITIVE');
});

void test('applyPayment succeeds even when the amount exceeds the current balance (NOT an error)', () => {
  // A real folded state where customer c1 has a 500-poisha balance.
  const priorEvents: AnyEvent[] = [
    {
      id: 'evt-1',
      device_id: 'device-a',
      seq: 1,
      hlc: '00000001',
      shop_id: 'shop-1',
      type: 'CUSTOMER_ADDED',
      payload: { schema_version: 1, customer_id: 'c1', display_name: 'Rahim', phone: null },
      created_at: 1_700_000_000_000,
      synced_at: null,
    },
    {
      id: 'evt-2',
      device_id: 'device-a',
      seq: 2,
      hlc: '00000002',
      shop_id: 'shop-1',
      type: 'CREDIT_GIVEN',
      payload: {
        schema_version: 1,
        entry_id: 'e1',
        customer_id: 'c1',
        amount_poisha: 500 as Poisha,
        note: null,
        occurred_at: null,
      },
      created_at: 1_700_000_001_000,
      synced_at: null,
    },
  ];
  const state = fold(priorEvents);
  assert.equal(state.balances.get('c1')?.balance_poisha, 500);

  // Pay 10,000 poisha against a 500-poisha balance — a huge overpayment.
  // EVENTS.md §8: "anomaly detection never blocks a write." This must
  // succeed exactly like a normal payment; catching it is anomalies.ts's
  // job, after the fold, not this function's job before it.
  const result = applyPayment(state, {
    ctx: ctx({ event_id: 'evt-overpay' }),
    entry_id: 'e2',
    customer_id: 'c1',
    amount_poisha: 10000 as Poisha,
    note: null,
    occurred_at: null,
  });

  assert.ok(Array.isArray(result), 'overpayment must succeed, not return a DomainError');
  const event = result[0];
  assert.ok(event !== undefined);
  assert.equal(event.type, 'PAYMENT_RECEIVED');
});

// ---------------------------------------------------------------------------
// applyCorrection
// ---------------------------------------------------------------------------

void test('applyCorrection produces an ENTRY_VOIDED event for a fresh target', () => {
  const result = applyCorrection(fold([]), {
    ctx: ctx({ event_id: 'evt-void-1' }),
    voids_event_id: 'evt-2',
    reason: 'MISTAKE',
  });
  assert.ok(Array.isArray(result), 'voiding a fresh target must succeed');
  const event = result[0];
  assert.ok(event !== undefined);
  assert.equal(event.type, 'ENTRY_VOIDED');
});

void test('applyCorrection succeeds voiding an already-voided target (double-void is NOT an error)', () => {
  const priorEvents: AnyEvent[] = [
    {
      id: 'evt-1',
      device_id: 'device-a',
      seq: 1,
      hlc: '00000001',
      shop_id: 'shop-1',
      type: 'CUSTOMER_ADDED',
      payload: { schema_version: 1, customer_id: 'c1', display_name: 'Rahim', phone: null },
      created_at: 1_700_000_000_000,
      synced_at: null,
    },
    {
      id: 'evt-2',
      device_id: 'device-a',
      seq: 2,
      hlc: '00000002',
      shop_id: 'shop-1',
      type: 'CREDIT_GIVEN',
      payload: {
        schema_version: 1,
        entry_id: 'e1',
        customer_id: 'c1',
        amount_poisha: 500 as Poisha,
        note: null,
        occurred_at: null,
      },
      created_at: 1_700_000_001_000,
      synced_at: null,
    },
    {
      id: 'evt-3',
      device_id: 'device-a',
      seq: 3,
      hlc: '00000003',
      shop_id: 'shop-1',
      type: 'ENTRY_VOIDED',
      payload: { schema_version: 1, voids_event_id: 'evt-2', reason: 'MISTAKE' },
      created_at: 1_700_000_002_000,
      synced_at: null,
    },
  ];
  const state = fold(priorEvents);
  assert.ok(state.voided.has('evt-2'), 'evt-2 should already be voided by the prior event');

  // Void the SAME target a second time — e.g. two offline devices each
  // recorded their own undo tap. EVENTS.md §3: voiding is idempotent.
  const result = applyCorrection(state, {
    ctx: ctx({ event_id: 'evt-void-2' }),
    voids_event_id: 'evt-2',
    reason: 'MISTAKE',
  });

  assert.ok(Array.isArray(result), 'double-void must succeed, not return a DomainError');
  const event = result[0];
  assert.ok(event !== undefined);
  assert.equal(event.type, 'ENTRY_VOIDED');
});

// ---------------------------------------------------------------------------
// applyArchiveCustomer — Step 11 audit item 7. Did not exist before this
// step; SECURITY.md §7's erasure path had no command to produce its event.
// ---------------------------------------------------------------------------

function customerAdded(id: string, name: string): AnyEvent {
  return {
    id,
    device_id: 'device-a',
    seq: 1,
    hlc: '00000001',
    shop_id: 'shop-1',
    type: 'CUSTOMER_ADDED',
    payload: { schema_version: 1, customer_id: 'c1', display_name: name, phone: null },
    created_at: 1_700_000_000_000,
    synced_at: null,
  };
}

void test('applyArchiveCustomer rejects a customer the fold has never seen', () => {
  const result = applyArchiveCustomer(fold([]), {
    ctx: ctx(),
    customer_id: 'ghost',
    reason: 'REQUESTED',
  });
  assert.ok(!Array.isArray(result), 'archiving an unknown customer must be rejected');
  assert.equal(result.code, 'UNKNOWN_CUSTOMER');
});

void test('applyArchiveCustomer produces a CUSTOMER_ARCHIVED event for a known customer', () => {
  const state = fold([customerAdded('evt-1', 'রহিম ভাই')]);
  const result = applyArchiveCustomer(state, {
    ctx: ctx({ event_id: 'evt-archive-1' }),
    customer_id: 'c1',
    reason: 'REQUESTED',
  });
  assert.ok(Array.isArray(result), 'archiving a known customer must succeed');
  const event = result[0];
  assert.ok(event !== undefined);
  assert.equal(event.type, 'CUSTOMER_ARCHIVED');
  if (event.type === 'CUSTOMER_ARCHIVED') {
    assert.equal(event.payload.customer_id, 'c1');
    assert.equal(event.payload.reason, 'REQUESTED');
  }

  // The fold actually reflects it — this is the "removed from the visible
  // list" proof at the projection level (SECURITY.md §7: "the shopkeeper
  // must be able to find and use it" — a future list screen queries exactly
  // this flag; see also eventStore.ts's projection-level test).
  const archivedState = fold([...[customerAdded('evt-1', 'রহিম ভাই')], event]);
  assert.equal(archivedState.customers.get('c1')?.archived, true);
});

void test('applyArchiveCustomer succeeds archiving an already-archived customer (idempotent, like ENTRY_VOIDED)', () => {
  const priorEvents: AnyEvent[] = [
    customerAdded('evt-1', 'রহিম ভাই'),
    {
      id: 'evt-2',
      device_id: 'device-a',
      seq: 2,
      hlc: '00000002',
      shop_id: 'shop-1',
      type: 'CUSTOMER_ARCHIVED',
      payload: { schema_version: 1, customer_id: 'c1', reason: 'INACTIVE' },
      created_at: 1_700_000_001_000,
      synced_at: null,
    },
  ];
  const state = fold(priorEvents);
  assert.equal(state.customers.get('c1')?.archived, true);

  const result = applyArchiveCustomer(state, {
    ctx: ctx({ event_id: 'evt-archive-2' }),
    customer_id: 'c1',
    reason: 'REQUESTED',
  });
  assert.ok(Array.isArray(result), 'archiving an already-archived customer must succeed, not error');
});
