// fold.test.ts — AGENTS.md §3.1/§3.3. Example coverage for the six core event
// types, plus the three guarantees AGENTS.md commits the fold to: order-
// independence under HLC sort, ENTRY_VOIDED idempotency, and determinism.
//
// fast-check is not installed in this repo (checked node_modules and
// package-lock.json directly — absent, not even transitively). Rather than
// add a new dependency silently, the property tests below use a small
// hand-written seeded PRNG (mulberry32, ~10 lines, no dependency) to generate
// random valid event sequences across many seeds. This delivers the same
// guarantee — many random trials, not a fixed example — without fast-check's
// automatic shrinking. Each property test logs how many seeds it ran, the
// same information fast-check would report as its run count.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fold } from '../src/fold.ts';
import { generateSequence, mulberry32, shuffle } from './generators.ts';
import type { AnyEvent, Poisha } from '../src/types.ts';

const RUNS = 100;
const STEPS_PER_RUN = 25;

// ---------------------------------------------------------------------------
// a. ORDER-INDEPENDENCE
// ---------------------------------------------------------------------------
void test('fold is order-independent under HLC sort (property, many random sequences)', () => {
  for (let seed = 0; seed < RUNS; seed++) {
    const events = generateSequence(seed, STEPS_PER_RUN);
    const shuffled = shuffle(events, mulberry32(seed * 7919 + 1));

    const original = fold(events);
    const reordered = fold(shuffled);

    assert.deepStrictEqual(
      reordered.balances,
      original.balances,
      `balances diverged after shuffling seed ${seed}`,
    );
    assert.deepStrictEqual(
      reordered.customers,
      original.customers,
      `customers diverged after shuffling seed ${seed}`,
    );
  }
  console.log(`  order-independence: ${RUNS} random sequences, ${STEPS_PER_RUN} events each`);
});

// ---------------------------------------------------------------------------
// b. IDEMPOTENCY — two ENTRY_VOIDED events for the same target == one
// ---------------------------------------------------------------------------
void test('ENTRY_VOIDED is idempotent (property, many random sequences)', () => {
  let checked = 0;
  for (let seed = 0; seed < RUNS; seed++) {
    const base = generateSequence(seed, STEPS_PER_RUN);
    const voidableTarget = base.find(
      (e) => e.type === 'CREDIT_GIVEN' || e.type === 'PAYMENT_RECEIVED',
    );
    if (!voidableTarget) continue; // this seed happened not to generate one — skip, don't fail

    const rand = mulberry32(seed * 104729 + 3);
    const makeVoid = (suffix: string): AnyEvent => ({
      id: `void-${seed}-${suffix}`,
      device_id: rand() < 0.5 ? 'device-a' : 'device-b',
      seq: 9000,
      hlc: '99999998',
      shop_id: 'shop-1',
      type: 'ENTRY_VOIDED',
      payload: { schema_version: 1, voids_event_id: voidableTarget.id, reason: 'DUPLICATE' },
      created_at: 1_700_099_000_000,
      synced_at: null,
    });

    const voidOnce = { ...makeVoid('a'), hlc: '99999999' };
    const voidTwiceA = { ...makeVoid('a'), hlc: '99999999' };
    const voidTwiceB = { ...makeVoid('b'), hlc: '99999999' };

    const foldedOnce = fold([...base, voidOnce]);
    const foldedTwice = fold([...base, voidTwiceA, voidTwiceB]);

    assert.deepStrictEqual(
      foldedTwice.balances,
      foldedOnce.balances,
      `double-void diverged from single-void for seed ${seed}`,
    );
    checked++;
  }
  assert.ok(checked > 0, 'no seed produced a voidable event — generator needs adjusting');
  console.log(`  idempotency: ${checked} of ${RUNS} random sequences had a voidable target`);
});

// ---------------------------------------------------------------------------
// c. DETERMINISM — folding the same input twice gives the same output
// ---------------------------------------------------------------------------
void test('fold is deterministic (property, many random sequences)', () => {
  for (let seed = 0; seed < RUNS; seed++) {
    const events = generateSequence(seed, STEPS_PER_RUN);
    const first = fold(events);
    const second = fold(events);
    assert.deepStrictEqual(second.balances, first.balances, `non-deterministic balances at seed ${seed}`);
    assert.deepStrictEqual(second.customers, first.customers, `non-deterministic customers at seed ${seed}`);
  }
  console.log(`  determinism: ${RUNS} random sequences, folded twice each`);
});

// ---------------------------------------------------------------------------
// Example-based coverage, one per core event type.
// ---------------------------------------------------------------------------
function envelope(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'evt-1',
    device_id: 'device-a',
    seq: 1,
    hlc: '00000001',
    shop_id: 'shop-1',
    created_at: 1_700_000_000_000,
    synced_at: null,
    ...overrides,
  };
}

void test('CUSTOMER_ADDED creates a customer', () => {
  const events: AnyEvent[] = [
    {
      ...envelope(),
      type: 'CUSTOMER_ADDED',
      payload: { schema_version: 1, customer_id: 'c1', display_name: 'Rahim', phone: null },
    },
  ];
  const state = fold(events);
  assert.deepStrictEqual(state.customers.get('c1'), {
    id: 'c1',
    display_name: 'Rahim',
    phone: null,
    archived: false,
  });
});

void test('CUSTOMER_RENAMED updates display_name; omitted phone is left unchanged', () => {
  const events: AnyEvent[] = [
    {
      ...envelope({ id: 'evt-1', hlc: '00000001' }),
      type: 'CUSTOMER_ADDED',
      payload: { schema_version: 1, customer_id: 'c1', display_name: 'Rahim', phone: '017' },
    },
    {
      ...envelope({ id: 'evt-2', hlc: '00000002' }),
      type: 'CUSTOMER_RENAMED',
      payload: { schema_version: 1, customer_id: 'c1', display_name: 'Rahim Bhai' },
    },
  ];
  const state = fold(events);
  assert.deepStrictEqual(state.customers.get('c1'), {
    id: 'c1',
    display_name: 'Rahim Bhai',
    phone: '017', // omitted in the rename payload — must survive unchanged
    archived: false,
  });
});

void test('CUSTOMER_ARCHIVED sets archived: true', () => {
  const events: AnyEvent[] = [
    {
      ...envelope({ id: 'evt-1', hlc: '00000001' }),
      type: 'CUSTOMER_ADDED',
      payload: { schema_version: 1, customer_id: 'c1', display_name: 'Rahim', phone: null },
    },
    {
      ...envelope({ id: 'evt-2', hlc: '00000002' }),
      type: 'CUSTOMER_ARCHIVED',
      payload: { schema_version: 1, customer_id: 'c1', reason: 'DUPLICATE' },
    },
  ];
  const state = fold(events);
  assert.equal(state.customers.get('c1')?.archived, true);
});

void test('CREDIT_GIVEN increases the customer balance', () => {
  const events: AnyEvent[] = [
    {
      ...envelope({ id: 'evt-1', hlc: '00000001' }),
      type: 'CUSTOMER_ADDED',
      payload: { schema_version: 1, customer_id: 'c1', display_name: 'Rahim', phone: null },
    },
    {
      ...envelope({ id: 'evt-2', hlc: '00000002' }),
      type: 'CREDIT_GIVEN',
      payload: {
        schema_version: 1,
        entry_id: 'e1',
        customer_id: 'c1',
        amount_poisha: 5000 as Poisha,
        note: null,
        occurred_at: null,
      },
    },
  ];
  const state = fold(events);
  assert.equal(state.balances.get('c1')?.balance_poisha, 5000);
});

void test('PAYMENT_RECEIVED decreases the customer balance', () => {
  const events: AnyEvent[] = [
    {
      ...envelope({ id: 'evt-1', hlc: '00000001' }),
      type: 'CUSTOMER_ADDED',
      payload: { schema_version: 1, customer_id: 'c1', display_name: 'Rahim', phone: null },
    },
    {
      ...envelope({ id: 'evt-2', hlc: '00000002' }),
      type: 'CREDIT_GIVEN',
      payload: {
        schema_version: 1,
        entry_id: 'e1',
        customer_id: 'c1',
        amount_poisha: 5000 as Poisha,
        note: null,
        occurred_at: null,
      },
    },
    {
      ...envelope({ id: 'evt-3', hlc: '00000003' }),
      type: 'PAYMENT_RECEIVED',
      payload: {
        schema_version: 1,
        entry_id: 'e2',
        customer_id: 'c1',
        amount_poisha: 2000 as Poisha,
        note: null,
        occurred_at: null,
      },
    },
  ];
  const state = fold(events);
  assert.equal(state.balances.get('c1')?.balance_poisha, 3000);
});

void test('ENTRY_VOIDED nullifies the effect of its target event', () => {
  const events: AnyEvent[] = [
    {
      ...envelope({ id: 'evt-1', hlc: '00000001' }),
      type: 'CUSTOMER_ADDED',
      payload: { schema_version: 1, customer_id: 'c1', display_name: 'Rahim', phone: null },
    },
    {
      ...envelope({ id: 'evt-2', hlc: '00000002' }),
      type: 'CREDIT_GIVEN',
      payload: {
        schema_version: 1,
        entry_id: 'e1',
        customer_id: 'c1',
        amount_poisha: 5000 as Poisha,
        note: null,
        occurred_at: null,
      },
    },
    {
      ...envelope({ id: 'evt-3', hlc: '00000003' }),
      type: 'ENTRY_VOIDED',
      payload: { schema_version: 1, voids_event_id: 'evt-2', reason: 'MISTAKE' },
    },
  ];
  const state = fold(events);
  // The voided CREDIT_GIVEN never happened as far as the balance is concerned.
  assert.equal(state.balances.has('c1'), false);
  assert.ok(state.voided.has('evt-2'));
});

