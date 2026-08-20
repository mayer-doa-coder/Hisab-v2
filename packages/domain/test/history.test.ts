// history.test.ts — customerHistory(). UI_SPEC.md screen 6's per-line
// running balance.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customerHistory } from '../src/history.ts';
import { generateSequence, mulberry32, shuffle } from './generators.ts';
import type { AnyEvent, Poisha } from '../src/types.ts';

function envelope(id: string, hlc: string, deviceId = 'device-a') {
  return {
    id,
    device_id: deviceId,
    seq: Number(hlc),
    hlc,
    shop_id: 'shop-1',
    created_at: 1_700_000_000_000 + Number(hlc) * 1000,
    synced_at: null,
  };
}

void test('customerHistory: credit then payment produces two lines with a correct running balance', () => {
  const events: AnyEvent[] = [
    {
      ...envelope('c1', '00000001'),
      type: 'CUSTOMER_ADDED',
      payload: { schema_version: 1, customer_id: 'cust-1', display_name: 'রহিম', phone: null },
    },
    {
      ...envelope('e1', '00000002'),
      type: 'CREDIT_GIVEN',
      payload: {
        schema_version: 1,
        entry_id: 'entry-1',
        customer_id: 'cust-1',
        amount_poisha: 50_000 as Poisha,
        note: null,
        occurred_at: null,
      },
    },
    {
      ...envelope('e2', '00000003'),
      type: 'PAYMENT_RECEIVED',
      payload: {
        schema_version: 1,
        entry_id: 'entry-2',
        customer_id: 'cust-1',
        amount_poisha: 20_000 as Poisha,
        note: null,
        occurred_at: null,
      },
    },
  ];

  const history = customerHistory(events, 'cust-1');
  assert.equal(history.length, 2);
  assert.equal(history[0]?.event.id, 'e1');
  assert.equal(history[0]?.voided, false);
  assert.equal(history[0]?.balance_after_poisha, 50_000);
  assert.equal(history[1]?.event.id, 'e2');
  assert.equal(history[1]?.voided, false);
  assert.equal(history[1]?.balance_after_poisha, 30_000);
});

void test('customerHistory: a voided line is kept, marked, and does not move the balance', () => {
  const events: AnyEvent[] = [
    {
      ...envelope('e1', '00000001'),
      type: 'CREDIT_GIVEN',
      payload: {
        schema_version: 1,
        entry_id: 'entry-1',
        customer_id: 'cust-1',
        amount_poisha: 50_000 as Poisha,
        note: null,
        occurred_at: null,
      },
    },
    {
      ...envelope('e2', '00000002'),
      type: 'CREDIT_GIVEN',
      payload: {
        schema_version: 1,
        entry_id: 'entry-2',
        customer_id: 'cust-1',
        amount_poisha: 10_000 as Poisha,
        note: null,
        occurred_at: null,
      },
    },
    {
      ...envelope('v1', '00000003'),
      type: 'ENTRY_VOIDED',
      payload: { schema_version: 1, voids_event_id: 'e2', reason: 'MISTAKE' },
    },
  ];

  const history = customerHistory(events, 'cust-1');
  assert.equal(history.length, 2);
  assert.equal(history[0]?.balance_after_poisha, 50_000);
  assert.equal(history[1]?.event.id, 'e2');
  assert.equal(history[1]?.voided, true);
  // Voided: the balance does not move past what it was before this line.
  assert.equal(history[1]?.balance_after_poisha, 50_000);
});

void test('customerHistory: events for another customer are excluded entirely', () => {
  const events: AnyEvent[] = [
    {
      ...envelope('e1', '00000001'),
      type: 'CREDIT_GIVEN',
      payload: {
        schema_version: 1,
        entry_id: 'entry-1',
        customer_id: 'cust-1',
        amount_poisha: 50_000 as Poisha,
        note: null,
        occurred_at: null,
      },
    },
    {
      ...envelope('e2', '00000002'),
      type: 'CREDIT_GIVEN',
      payload: {
        schema_version: 1,
        entry_id: 'entry-2',
        customer_id: 'cust-2',
        amount_poisha: 99_000 as Poisha,
        note: null,
        occurred_at: null,
      },
    },
  ];

  const history = customerHistory(events, 'cust-1');
  assert.equal(history.length, 1);
  assert.equal(history[0]?.event.id, 'e1');
});

void test('customerHistory: order-independent under HLC sort (property, many random sequences)', () => {
  const RUNS = 50;
  const STEPS_PER_RUN = 25;
  for (let seed = 0; seed < RUNS; seed++) {
    const events = generateSequence(seed, STEPS_PER_RUN);
    const shuffled = shuffle(events, mulberry32(seed * 7919 + 1));

    const customerId = `customer-${seed}-0`;
    const original = customerHistory(events, customerId);
    const reordered = customerHistory(shuffled, customerId);

    assert.deepStrictEqual(reordered, original, `history diverged after shuffling seed ${seed}`);
  }
  console.log(`  order-independence: ${RUNS} random sequences, ${STEPS_PER_RUN} events each`);
});
