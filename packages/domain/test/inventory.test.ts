// inventory.test.ts — EVENTS.md §4/§7. Same rigor and the same three
// guarantees fold.test.ts holds the core fold to (order-independence, void
// idempotency, determinism), plus the one that is specific to this file:
//
//   STOCK IS ALWAYS A FOLD. There is no cached quantity anywhere, and the
//   property test below proves it by recomputing every product's quantity
//   from the raw movement events and demanding the fold agree, on 100 random
//   sequences. If anyone ever introduces a stored quantity that drifts, this
//   is the test that fails.
//
// Property tests use the same hand-written mulberry32 PRNG as fold.test.ts
// (fast-check is still not a dependency — see fold.test.ts's header for why),
// and each logs its run count the way fast-check would.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expiryRisks, foldInventory, parseIsoDateUtc, stockLevel } from '../src/inventory.ts';
import { fold } from '../src/fold.ts';
import { detectAnomalies } from '../src/anomalies.ts';
import { generateInventorySequence, mulberry32, shuffle } from './generators.ts';
import type { AnyEvent, Poisha } from '../src/types.ts';

const RUNS = 100;
const STEPS_PER_RUN = 30;

function envelope(over: Partial<AnyEvent> & { id: string; hlc: string }) {
  return {
    device_id: 'device-a',
    seq: 1,
    shop_id: 'shop-1',
    created_at: 1_700_000_000_000,
    synced_at: 1_700_000_500_000 as number | null,
    ...over,
  };
}

function productAdded(id: string, hlc: string, productId: string, threshold: number | null): AnyEvent {
  return {
    ...envelope({ id, hlc }),
    type: 'PRODUCT_ADDED',
    payload: {
      schema_version: 1,
      product_id: productId,
      name: 'চাল',
      unit: 'KG',
      sale_price_poisha: 6000 as Poisha,
      low_stock_threshold_units: threshold,
    },
  };
}

function stockReceived(
  id: string,
  hlc: string,
  productId: string,
  qty: number,
  expiry: string | null,
): AnyEvent {
  return {
    ...envelope({ id, hlc }),
    type: 'STOCK_RECEIVED',
    payload: {
      schema_version: 1,
      movement_id: `mv-${id}`,
      product_id: productId,
      quantity_units: qty,
      cost_price_poisha: 5000 as Poisha,
      expiry_date: expiry,
      occurred_at: null,
    },
  };
}

function stockSold(id: string, hlc: string, productId: string, qty: number): AnyEvent {
  return {
    ...envelope({ id, hlc }),
    type: 'STOCK_SOLD',
    payload: {
      schema_version: 1,
      movement_id: `mv-${id}`,
      product_id: productId,
      quantity_units: qty,
      sale_price_poisha: 6000 as Poisha,
      sale_id: 'sale-1',
      occurred_at: null,
    },
  };
}

// ===========================================================================
// THE NON-NEGOTIABLE ONE: stock is a fold over movements, never a stored field
// ===========================================================================

/**
 * Recomputes on-hand quantity from the raw events, completely independently of
 * inventory.ts — a different implementation, so agreement is evidence rather
 * than a tautology. This is the check that would have caught v1's
 * Product.quantity / InventoryBatch.quantity drift.
 */
function quantitiesFromScratch(events: readonly AnyEvent[]): Map<string, number> {
  const voided = new Set<string>();
  for (const e of events) {
    if (e.type === 'ENTRY_VOIDED') voided.add(e.payload.voids_event_id);
  }
  const totals = new Map<string, number>();
  const bump = (id: string, delta: number) => totals.set(id, (totals.get(id) ?? 0) + delta);
  for (const e of events) {
    if (voided.has(e.id)) continue;
    if (e.type === 'STOCK_RECEIVED') bump(e.payload.product_id, e.payload.quantity_units);
    else if (e.type === 'STOCK_SOLD') bump(e.payload.product_id, -e.payload.quantity_units);
    else if (e.type === 'STOCK_ADJUSTED') bump(e.payload.product_id, e.payload.delta_units);
  }
  return totals;
}

void test('stock is ALWAYS a fold over movements — never a cached quantity (property)', () => {
  for (let seed = 0; seed < RUNS; seed++) {
    const events = generateInventorySequence(seed, STEPS_PER_RUN);
    const state = foldInventory(events);
    const expected = quantitiesFromScratch(events);

    assert.equal(
      state.stock.size,
      expected.size,
      `seed ${seed}: fold produced ${state.stock.size} stock rows, independent recount produced ${expected.size}`,
    );
    for (const [productId, quantity] of expected) {
      assert.equal(
        state.stock.get(productId)?.quantity_units,
        quantity,
        `seed ${seed}: product ${productId} drifted from the independent recount`,
      );
    }
  }
  console.log(`  stock-is-a-fold: ${RUNS} random sequences, ${STEPS_PER_RUN} events each`);
});

void test('ProductState has no quantity field — stock lives only in the stock projection', () => {
  const events = [productAdded('p1', '00000001', 'prod-1', 5), stockReceived('s1', '00000002', 'prod-1', 12, null)];
  const state = foldInventory(events);
  const product = state.products.get('prod-1');
  assert.ok(product !== undefined);

  // Runtime half of the guarantee: whatever the type says, the object really
  // does not carry a quantity that could drift from the stock projection.
  for (const key of ['quantity', 'quantity_units', 'stock', 'on_hand']) {
    assert.equal(key in product, false, `ProductState must not carry \`${key}\` — that is the v1 bug`);
  }
  assert.equal(state.stock.get('prod-1')?.quantity_units, 12);
});

/**
 * Compile-time half. `keyof ProductState` is checked to exclude every name a
 * cached quantity would plausibly be given. Adding `quantity` to ProductState
 * in types.ts turns this into a type error at `npm run typecheck`, before any
 * test runs — which is the point: the guard should fire on the commit that
 * introduces the field, not on some later run where the two numbers happen to
 * disagree.
 */
type ProductStateKeys = keyof import('../src/types.ts').ProductState;
type AssertNoCachedQuantity =
  'quantity' extends ProductStateKeys
    ? never
    : 'quantity_units' extends ProductStateKeys
      ? never
      : 'on_hand' extends ProductStateKeys
        ? never
        : true;
const _noCachedQuantity: AssertNoCachedQuantity = true;
void _noCachedQuantity;

// ===========================================================================
// The three guarantees fold.test.ts holds the core fold to
// ===========================================================================

void test('foldInventory is order-independent under HLC sort (property)', () => {
  for (let seed = 0; seed < RUNS; seed++) {
    const events = generateInventorySequence(seed, STEPS_PER_RUN);
    const shuffled = shuffle(events, mulberry32(seed * 7919 + 11));

    const original = foldInventory(events);
    const reordered = foldInventory(shuffled);

    assert.deepStrictEqual(reordered.stock, original.stock, `stock diverged after shuffling seed ${seed}`);
    assert.deepStrictEqual(
      reordered.products,
      original.products,
      `products diverged after shuffling seed ${seed}`,
    );
  }
  console.log(`  inventory order-independence: ${RUNS} random sequences`);
});

void test('foldInventory is deterministic — same input, identical output (property)', () => {
  for (let seed = 0; seed < RUNS; seed++) {
    const events = generateInventorySequence(seed, STEPS_PER_RUN);
    assert.deepStrictEqual(foldInventory(events), foldInventory(events), `seed ${seed} not deterministic`);
  }
  console.log(`  inventory determinism: ${RUNS} random sequences`);
});

void test('ENTRY_VOIDED on a STOCK_SOLD puts the units back', () => {
  const base = [
    productAdded('p1', '00000001', 'prod-1', null),
    stockReceived('s1', '00000002', 'prod-1', 20, null),
    stockSold('s2', '00000003', 'prod-1', 8),
  ];
  assert.equal(foldInventory(base).stock.get('prod-1')?.quantity_units, 12);

  const voided: AnyEvent = {
    ...envelope({ id: 'v1', hlc: '00000004' }),
    type: 'ENTRY_VOIDED',
    payload: { schema_version: 1, voids_event_id: 's2', reason: 'MISTAKE' },
  };
  // The sale did not happen, so the units never left.
  assert.equal(foldInventory([...base, voided]).stock.get('prod-1')?.quantity_units, 20);
});

void test('voiding is idempotent for stock, exactly as for balances (property)', () => {
  let checked = 0;
  for (let seed = 0; seed < RUNS; seed++) {
    const base = generateInventorySequence(seed, STEPS_PER_RUN);
    const target = base.find((e) => e.type === 'STOCK_SOLD' || e.type === 'STOCK_RECEIVED');
    if (!target) continue;

    const mk = (suffix: string): AnyEvent => ({
      ...envelope({ id: `void-${seed}-${suffix}`, hlc: '99999999' }),
      device_id: 'device-a',
      seq: 9000,
      type: 'ENTRY_VOIDED',
      payload: { schema_version: 1, voids_event_id: target.id, reason: 'DUPLICATE' },
    });

    assert.deepStrictEqual(
      foldInventory([...base, mk('a'), mk('b')]).stock,
      foldInventory([...base, mk('a')]).stock,
      `seed ${seed}: a second void changed the stock projection`,
    );
    checked++;
  }
  console.log(`  stock void idempotency: ${checked} of ${RUNS} seeds had a voidable movement`);
});

// ===========================================================================
// Product projection semantics
// ===========================================================================

void test('PRODUCT_UPDATED: omitted means unchanged, explicit null clears', () => {
  const events: AnyEvent[] = [
    productAdded('p1', '00000001', 'prod-1', 5),
    {
      ...envelope({ id: 'p2', hlc: '00000002' }),
      type: 'PRODUCT_UPDATED',
      // `name` omitted entirely; `sale_price_poisha` explicitly nulled.
      payload: { schema_version: 1, product_id: 'prod-1', sale_price_poisha: null },
    },
  ];
  const product = foldInventory(events).products.get('prod-1');
  assert.equal(product?.name, 'চাল', 'an omitted field must be left unchanged');
  assert.equal(product?.sale_price_poisha, null, 'an explicit null must clear the value');
  assert.equal(product?.low_stock_threshold_units, 5, 'other omitted fields stay put too');
});

void test('PRODUCT_ARCHIVED hides the product but never deletes its stock history', () => {
  const events = [
    productAdded('p1', '00000001', 'prod-1', null),
    stockReceived('s1', '00000002', 'prod-1', 7, null),
    {
      ...envelope({ id: 'a1', hlc: '00000003' }),
      type: 'PRODUCT_ARCHIVED' as const,
      payload: { schema_version: 1 as const, product_id: 'prod-1' },
    },
  ];
  const state = foldInventory(events);
  assert.equal(state.products.get('prod-1')?.archived, true);
  assert.equal(state.stock.get('prod-1')?.quantity_units, 7, 'archiving is not deletion');
});

void test('a movement for an unknown product still counts, like CREDIT_GIVEN for an unknown customer', () => {
  const state = foldInventory([stockReceived('s1', '00000001', 'ghost', 4, null)]);
  assert.equal(state.stock.get('ghost')?.quantity_units, 4);
  assert.equal(state.products.has('ghost'), false, 'but no product row is fabricated');
});

void test('PRODUCT_UPDATED for an unknown product is skipped, not fabricated', () => {
  const state = foldInventory([
    {
      ...envelope({ id: 'u1', hlc: '00000001' }),
      type: 'PRODUCT_UPDATED' as const,
      payload: { schema_version: 1 as const, product_id: 'ghost', name: 'Nothing' },
    },
  ]);
  assert.equal(state.products.has('ghost'), false);
});

void test('pendingProductIds tracks only unsynced events, voided ones included', () => {
  const synced = { ...stockReceived('s1', '00000001', 'prod-1', 5, null), synced_at: 1_700_000_900_000 };
  const unsynced = { ...stockSold('s2', '00000002', 'prod-2', 1), synced_at: null };
  const state = foldInventory([synced, unsynced]);
  assert.equal(state.pendingProductIds.has('prod-1'), false);
  assert.equal(state.pendingProductIds.has('prod-2'), true);
});

// ===========================================================================
// fold() delegates — LedgerState now really carries stock
// ===========================================================================

void test('fold() surfaces the inventory projections, and agrees with foldInventory exactly', () => {
  for (let seed = 0; seed < 25; seed++) {
    const events = generateInventorySequence(seed, STEPS_PER_RUN);
    const ledger = fold(events);
    const inventory = foldInventory(events);
    assert.deepStrictEqual(ledger.stock, inventory.stock, `seed ${seed}`);
    assert.deepStrictEqual(ledger.products, inventory.products, `seed ${seed}`);
    assert.deepStrictEqual(ledger.pendingProductIds, inventory.pendingProductIds, `seed ${seed}`);
  }
  console.log('  fold/foldInventory agreement: 25 random sequences');
});

void test('NEGATIVE_STOCK anomaly fires when two offline devices oversell', () => {
  const events = [
    productAdded('p1', '00000001', 'prod-1', null),
    stockReceived('s1', '00000002', 'prod-1', 1, null),
    { ...stockSold('s2', '00000003', 'prod-1', 1), device_id: 'device-a' },
    { ...stockSold('s3', '00000003', 'prod-1', 1), device_id: 'device-b' },
  ];
  const state = fold(events);
  assert.equal(state.stock.get('prod-1')?.quantity_units, -1, 'the write is never blocked');

  const anomalies = detectAnomalies(state, events);
  const negative = anomalies.filter((a) => a.kind === 'NEGATIVE_STOCK');
  assert.equal(negative.length, 1);
  const only = negative[0];
  assert.ok(only !== undefined && only.kind === 'NEGATIVE_STOCK');
  assert.equal(only.product_id, 'prod-1');
  assert.equal(only.quantity_units, -1);
  // Both sales plus the receipt are offered as candidates to review.
  assert.equal(only.candidates.length, 3);
});

// ===========================================================================
// stockLevel — the committed bucketing from viewmodels/product.ts
// ===========================================================================

void test('stockLevel buckets exactly as apps/mobile/src/viewmodels/product.ts documents', () => {
  assert.equal(stockLevel(-1, 5), 'NEGATIVE');
  assert.equal(stockLevel(0, 5), 'OUT');
  assert.equal(stockLevel(0, null), 'OUT');
  assert.equal(stockLevel(5, 5), 'LOW', 'the threshold itself is LOW — the boundary is inclusive');
  assert.equal(stockLevel(6, 5), 'OK');
  assert.equal(stockLevel(1, null), 'OK', 'a null threshold is never LOW');
  assert.equal(stockLevel(0.5, 1), 'LOW', 'fractional quantities are legitimate for KG/LITRE');
});

// ===========================================================================
// Expiry — the simplified, non-FEFO rule
// ===========================================================================

const NOW_2026 = Date.UTC(2026, 7, 20); // 2026-08-20, a fixed literal, not a clock read

void test('parseIsoDateUtc accepts YYYY-MM-DD and rejects everything else', () => {
  assert.equal(parseIsoDateUtc('2026-03-01'), Date.UTC(2026, 2, 1));
  assert.equal(parseIsoDateUtc('2026-02-31'), null, 'a day that does not exist must not roll over');
  assert.equal(parseIsoDateUtc('2026-13-01'), null);
  assert.equal(parseIsoDateUtc('01/03/2026'), null);
  assert.equal(parseIsoDateUtc('2026-3-1'), null, 'strict zero-padding');
  assert.equal(parseIsoDateUtc(''), null);
});

void test('expiry: nothing is reported when the product has sold out', () => {
  const events = [
    productAdded('p1', '00000001', 'prod-1', null),
    stockReceived('s1', '00000002', 'prod-1', 10, '2020-01-01'),
    stockSold('s2', '00000003', 'prod-1', 10),
  ];
  const state = foldInventory(events);
  assert.equal(state.stock.get('prod-1')?.quantity_units, 0);
  assert.deepEqual(
    expiryRisks(state, events, NOW_2026),
    [],
    'sold out means nothing expired is on the shelf, whichever batch it came from',
  );
});

void test('expiry: the reported number is an upper bound, capped by what is on hand', () => {
  const events = [
    productAdded('p1', '00000001', 'prod-1', null),
    stockReceived('s1', '00000002', 'prod-1', 10, '2020-01-01'), // expired batch
    stockReceived('s2', '00000003', 'prod-1', 10, '2099-12-31'), // fine
    stockSold('s3', '00000004', 'prod-1', 17),
  ];
  const state = foldInventory(events);
  assert.equal(state.stock.get('prod-1')?.quantity_units, 3);

  const risks = expiryRisks(state, events, NOW_2026);
  assert.equal(risks.length, 1);
  const risk = risks[0];
  assert.ok(risk !== undefined);
  assert.equal(risk.expired_batch_units, 10);
  assert.equal(risk.on_hand_units, 3);
  // NOT 10: only 3 units exist, so at most 3 of them can be from the old batch.
  // Sound under FEFO, FIFO, LIFO or any other order — which is the whole point,
  // because no event says which batch the 17 sold units came from.
  assert.equal(risk.at_most_expired_units, 3);
  assert.equal(risk.earliest_expired_date, '2020-01-01');
});

void test('expiry: a batch is not expired until its day has fully elapsed', () => {
  const events = [
    productAdded('p1', '00000001', 'prod-1', null),
    stockReceived('s1', '00000002', 'prod-1', 5, '2026-08-20'),
  ];
  const state = foldInventory(events);
  const expiryDay = Date.UTC(2026, 7, 20);

  assert.deepEqual(expiryRisks(state, events, expiryDay), [], 'still good on the expiry day itself');
  assert.deepEqual(
    expiryRisks(state, events, expiryDay + 86_400_000 - 1),
    [],
    'still good one millisecond before the day ends',
  );
  assert.equal(expiryRisks(state, events, expiryDay + 86_400_000).length, 1, 'expired once the day is over');
});

void test('expiry: null and malformed expiry dates are silently ignored, never guessed at', () => {
  const events = [
    productAdded('p1', '00000001', 'prod-1', null),
    stockReceived('s1', '00000002', 'prod-1', 5, null),
    stockReceived('s2', '00000003', 'prod-1', 5, 'sometime next year'),
  ];
  assert.deepEqual(expiryRisks(foldInventory(events), events, NOW_2026), []);
});

void test('expiry: a voided receipt never happened, and an archived product is silent', () => {
  const base = [
    productAdded('p1', '00000001', 'prod-1', null),
    stockReceived('s1', '00000002', 'prod-1', 5, '2020-01-01'),
    stockReceived('s2', '00000003', 'prod-1', 5, '2099-01-01'),
  ];
  assert.equal(expiryRisks(foldInventory(base), base, NOW_2026).length, 1);

  const withVoid: AnyEvent[] = [
    ...base,
    {
      ...envelope({ id: 'v1', hlc: '00000004' }),
      type: 'ENTRY_VOIDED',
      payload: { schema_version: 1, voids_event_id: 's1', reason: 'MISTAKE' },
    },
  ];
  assert.deepEqual(expiryRisks(foldInventory(withVoid), withVoid, NOW_2026), []);

  const withArchive: AnyEvent[] = [
    ...base,
    {
      ...envelope({ id: 'a1', hlc: '00000005' }),
      type: 'PRODUCT_ARCHIVED',
      payload: { schema_version: 1, product_id: 'prod-1' },
    },
  ];
  assert.deepEqual(expiryRisks(foldInventory(withArchive), withArchive, NOW_2026), []);
});

void test('expiry never reports more than is on hand, and never on a sold-out product (property)', () => {
  for (let seed = 0; seed < RUNS; seed++) {
    const events = generateInventorySequence(seed, STEPS_PER_RUN);
    const state = foldInventory(events);
    for (const risk of expiryRisks(state, events, NOW_2026)) {
      assert.ok(risk.at_most_expired_units > 0, `seed ${seed}: reported a zero-unit risk`);
      assert.ok(
        risk.at_most_expired_units <= risk.on_hand_units,
        `seed ${seed}: claimed more expired units than exist on hand`,
      );
      assert.ok(
        risk.at_most_expired_units <= risk.expired_batch_units,
        `seed ${seed}: claimed more expired units than were ever received expired`,
      );
      assert.ok(risk.on_hand_units > 0, `seed ${seed}: reported a risk on a sold-out product`);
    }
  }
  console.log(`  expiry upper-bound soundness: ${RUNS} random sequences`);
});

// ===========================================================================
// NO FEFO — an explicit assertion, not just an absence
// ===========================================================================

void test('there is no FEFO consumption order: which batch was sold is genuinely unknowable', () => {
  // Two batches, one expiring first. Sell exactly the quantity of the older
  // batch. FEFO logic would conclude the expired batch is gone and report
  // nothing; LIFO logic would conclude it is all still there and report 5.
  const events = [
    productAdded('p1', '00000001', 'prod-1', null),
    stockReceived('s1', '00000002', 'prod-1', 5, '2020-01-01'),
    stockReceived('s2', '00000003', 'prod-1', 5, '2099-01-01'),
    stockSold('s3', '00000004', 'prod-1', 5),
  ];
  const state = foldInventory(events);
  const risks = expiryRisks(state, events, NOW_2026);
  const risk = risks[0];
  assert.ok(risk !== undefined);

  // We say "at most 5", which is true under both readings and commits to
  // neither. STOCK_SOLD carries no batch reference (EVENTS.md §4), so any
  // narrower claim would be invented.
  assert.equal(risk.at_most_expired_units, 5);
  assert.equal(risk.on_hand_units, 5);
});
