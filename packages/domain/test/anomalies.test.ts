// anomalies.test.ts — EVENTS.md §8. Example coverage for NEGATIVE_BALANCE and
// DUPLICATE_SUSPECTED, plus a property test reusing fold.test.ts's random
// sequence generator: detectAnomalies never throws, and NEGATIVE_BALANCE
// fires if and only if the folded balance is actually negative.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectAnomalies } from '../src/anomalies.ts';
import { fold } from '../src/fold.ts';
import { isNegative } from '../src/money.ts';
import { generateSequence } from './generators.ts';
import type { AnyEvent, Poisha } from '../src/types.ts';

// ---------------------------------------------------------------------------
// NEGATIVE_BALANCE
// ---------------------------------------------------------------------------

void test('NEGATIVE_BALANCE fires when a payment exceeds the credited amount', () => {
  const events: AnyEvent[] = [
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
      type: 'PAYMENT_RECEIVED',
      payload: {
        schema_version: 1,
        entry_id: 'e2',
        customer_id: 'c1',
        amount_poisha: 2000 as Poisha,
        note: null,
        occurred_at: null,
      },
      created_at: 1_700_000_002_000,
      synced_at: null,
    },
  ];
  const state = fold(events);
  assert.equal(state.balances.get('c1')?.balance_poisha, -1500);

  const anomalies = detectAnomalies(state, events);
  const negative = anomalies.find((a) => a.kind === 'NEGATIVE_BALANCE');
  assert.ok(negative !== undefined, 'expected a NEGATIVE_BALANCE anomaly');
  if (negative?.kind === 'NEGATIVE_BALANCE') {
    assert.equal(negative.customer_id, 'c1');
    assert.equal(negative.amount_poisha, -1500);
    assert.equal(negative.candidates.length, 2); // the CREDIT_GIVEN and the PAYMENT_RECEIVED
  }
});

void test('NEGATIVE_BALANCE does not fire for a non-negative balance', () => {
  const events: AnyEvent[] = [
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
  const state = fold(events);
  const anomalies = detectAnomalies(state, events);
  assert.equal(
    anomalies.some((a) => a.kind === 'NEGATIVE_BALANCE'),
    false,
  );
});

// ---------------------------------------------------------------------------
// DUPLICATE_SUSPECTED
// ---------------------------------------------------------------------------

void test('DUPLICATE_SUSPECTED fires for same customer, same amount, close timestamps', () => {
  const events: AnyEvent[] = [
    {
      id: 'evt-1',
      device_id: 'device-a',
      seq: 1,
      hlc: '00000001',
      shop_id: 'shop-1',
      type: 'PAYMENT_RECEIVED',
      payload: {
        schema_version: 1,
        entry_id: 'e1',
        customer_id: 'c1',
        amount_poisha: 500 as Poisha,
        note: null,
        occurred_at: null,
      },
      created_at: 1_700_000_000_000,
      synced_at: null,
    },
    {
      id: 'evt-2',
      device_id: 'device-b', // a second, offline device
      seq: 1,
      hlc: '00000002',
      shop_id: 'shop-1',
      type: 'PAYMENT_RECEIVED',
      payload: {
        schema_version: 1,
        entry_id: 'e2',
        customer_id: 'c1',
        amount_poisha: 500 as Poisha,
        note: null,
        occurred_at: null,
      },
      created_at: 1_700_000_010_000, // 10 seconds later — inside any reasonable window
      synced_at: null,
    },
  ];
  const state = fold(events);
  const anomalies = detectAnomalies(state, events);
  const duplicate = anomalies.find((a) => a.kind === 'DUPLICATE_SUSPECTED');
  assert.ok(duplicate !== undefined, 'expected a DUPLICATE_SUSPECTED anomaly');
});

void test('DUPLICATE_SUSPECTED does not fire for different amounts', () => {
  const events: AnyEvent[] = [
    {
      id: 'evt-1',
      device_id: 'device-a',
      seq: 1,
      hlc: '00000001',
      shop_id: 'shop-1',
      type: 'PAYMENT_RECEIVED',
      payload: {
        schema_version: 1,
        entry_id: 'e1',
        customer_id: 'c1',
        amount_poisha: 500 as Poisha,
        note: null,
        occurred_at: null,
      },
      created_at: 1_700_000_000_000,
      synced_at: null,
    },
    {
      id: 'evt-2',
      device_id: 'device-b',
      seq: 1,
      hlc: '00000002',
      shop_id: 'shop-1',
      type: 'PAYMENT_RECEIVED',
      payload: {
        schema_version: 1,
        entry_id: 'e2',
        customer_id: 'c1',
        amount_poisha: 700 as Poisha, // different amount
        note: null,
        occurred_at: null,
      },
      created_at: 1_700_000_010_000,
      synced_at: null,
    },
  ];
  const state = fold(events);
  const anomalies = detectAnomalies(state, events);
  assert.equal(
    anomalies.some((a) => a.kind === 'DUPLICATE_SUSPECTED'),
    false,
  );
});

void test('a voided payment is excluded from DUPLICATE_SUSPECTED', () => {
  const events: AnyEvent[] = [
    {
      id: 'evt-1',
      device_id: 'device-a',
      seq: 1,
      hlc: '00000001',
      shop_id: 'shop-1',
      type: 'PAYMENT_RECEIVED',
      payload: {
        schema_version: 1,
        entry_id: 'e1',
        customer_id: 'c1',
        amount_poisha: 500 as Poisha,
        note: null,
        occurred_at: null,
      },
      created_at: 1_700_000_000_000,
      synced_at: null,
    },
    {
      id: 'evt-2',
      device_id: 'device-b',
      seq: 1,
      hlc: '00000002',
      shop_id: 'shop-1',
      type: 'PAYMENT_RECEIVED',
      payload: {
        schema_version: 1,
        entry_id: 'e2',
        customer_id: 'c1',
        amount_poisha: 500 as Poisha,
        note: null,
        occurred_at: null,
      },
      created_at: 1_700_000_010_000,
      synced_at: null,
    },
    {
      id: 'evt-3',
      device_id: 'device-a',
      seq: 2,
      hlc: '00000003',
      shop_id: 'shop-1',
      type: 'ENTRY_VOIDED',
      payload: { schema_version: 1, voids_event_id: 'evt-2', reason: 'DUPLICATE' },
      created_at: 1_700_000_011_000,
      synced_at: null,
    },
  ];
  const state = fold(events);
  const anomalies = detectAnomalies(state, events);
  assert.equal(
    anomalies.some((a) => a.kind === 'DUPLICATE_SUSPECTED'),
    false,
    'one of the two payments was voided, so there is no live duplicate to suspect',
  );
});

// ---------------------------------------------------------------------------
// Property test — reuses fold.test.ts's generator (Step 4).
// ---------------------------------------------------------------------------
const RUNS = 100;
const STEPS_PER_RUN = 25;

void test('detectAnomalies never throws; NEGATIVE_BALANCE fires iff the folded balance is negative (property)', () => {
  for (let seed = 0; seed < RUNS; seed++) {
    const events = generateSequence(seed, STEPS_PER_RUN);
    const state = fold(events);

    let anomalies: ReturnType<typeof detectAnomalies> = [];
    assert.doesNotThrow(() => {
      anomalies = detectAnomalies(state, events);
    }, `detectAnomalies threw for seed ${seed}`);

    const flaggedCustomerIds = new Set(
      anomalies.filter((a) => a.kind === 'NEGATIVE_BALANCE').map((a) => a.customer_id),
    );

    for (const [customerId, balance] of state.balances) {
      assert.equal(
        flaggedCustomerIds.has(customerId),
        isNegative(balance.balance_poisha),
        `NEGATIVE_BALANCE presence mismatch for ${customerId} at seed ${seed}`,
      );
    }
  }
  console.log(`  detectAnomalies property: ${RUNS} random sequences, ${STEPS_PER_RUN} events each`);
});
