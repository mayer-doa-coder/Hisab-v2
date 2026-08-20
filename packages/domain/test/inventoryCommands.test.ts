// inventoryCommands.test.ts — EVENTS.md §4. Same shape and rigor as
// commands.test.ts, including its most important habit: covering the cases
// that must NOT be errors as carefully as the ones that must be. A suite that
// only tests rejections lets a later change quietly turn "line items do not
// sum to the total" or "selling more than you have" into a blocked write, and
// both of those are things EVENTS.md commits to allowing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addProduct,
  adjustStock,
  receiveStock,
  recordSale,
  saleEventCount,
} from '../src/inventoryCommands.ts';
import { fold } from '../src/fold.ts';
import { foldInventory } from '../src/inventory.ts';
import { detectAnomalies } from '../src/anomalies.ts';
import type { AnyEvent, CommandContext, Poisha, RecordSaleCommand } from '../src/types.ts';

const EMPTY = fold([]);

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

/** N contexts with distinct ids and seqs, the way the data layer allocates them. */
function ctxs(n: number): CommandContext[] {
  return Array.from({ length: n }, (_, i) =>
    ctx({ event_id: `evt-${i + 1}`, seq: i + 1, hlc: String(i + 1).padStart(8, '0') }),
  );
}

// ===========================================================================
// addProduct
// ===========================================================================

void test('addProduct produces a PRODUCT_ADDED event', () => {
  const result = addProduct(EMPTY, {
    ctx: ctx({ event_id: 'evt-p1' }),
    product_id: 'prod-1',
    name: 'চাল',
    unit: 'KG',
    sale_price_poisha: 6000 as Poisha,
    low_stock_threshold_units: 5,
  });
  assert.ok(Array.isArray(result), 'a valid product must succeed');
  assert.equal(result.length, 1);
  const event = result[0];
  assert.ok(event !== undefined);
  assert.equal(event.type, 'PRODUCT_ADDED');
  assert.equal(event.id, 'evt-p1');
  if (event.type === 'PRODUCT_ADDED') {
    assert.equal(event.payload.name, 'চাল');
    assert.equal(event.payload.unit, 'KG');
  }
});

void test('addProduct rejects a blank name', () => {
  const result = addProduct(EMPTY, {
    ctx: ctx(),
    product_id: 'prod-1',
    name: '   ',
    unit: 'PIECE',
    sale_price_poisha: null,
    low_stock_threshold_units: null,
  });
  assert.ok(!Array.isArray(result));
  assert.equal(result.code, 'NAME_EMPTY');
});

void test('addProduct rejects a negative threshold but ACCEPTS zero', () => {
  const negative = addProduct(EMPTY, {
    ctx: ctx(),
    product_id: 'prod-1',
    name: 'চাল',
    unit: 'KG',
    sale_price_poisha: null,
    low_stock_threshold_units: -1,
  });
  assert.ok(!Array.isArray(negative));
  assert.equal(negative.code, 'THRESHOLD_NEGATIVE');

  // 0 is a real setting: "tell me only when it runs out."
  const zero = addProduct(EMPTY, {
    ctx: ctx(),
    product_id: 'prod-1',
    name: 'চাল',
    unit: 'KG',
    sale_price_poisha: null,
    low_stock_threshold_units: 0,
  });
  assert.ok(Array.isArray(zero), 'a zero threshold must be accepted, not treated as missing');
});

void test('addProduct accepts a null price — not every shop prices every item', () => {
  const result = addProduct(EMPTY, {
    ctx: ctx(),
    product_id: 'prod-1',
    name: 'চাল',
    unit: 'KG',
    sale_price_poisha: null,
    low_stock_threshold_units: null,
  });
  assert.ok(Array.isArray(result));
});

// ===========================================================================
// receiveStock
// ===========================================================================

void test('receiveStock produces STOCK_RECEIVED and the fold picks it up', () => {
  const result = receiveStock(EMPTY, {
    ctx: ctx({ event_id: 'evt-s1' }),
    movement_id: 'mv-1',
    product_id: 'prod-1',
    quantity_units: 25,
    cost_price_poisha: 5000 as Poisha,
    expiry_date: '2026-12-31',
    occurred_at: null,
  });
  assert.ok(Array.isArray(result));
  assert.equal(result[0]?.type, 'STOCK_RECEIVED');
  assert.equal(foldInventory(result).stock.get('prod-1')?.quantity_units, 25);
});

void test('receiveStock accepts a fractional quantity — KG and LITRE are real units', () => {
  const result = receiveStock(EMPTY, {
    ctx: ctx(),
    movement_id: 'mv-1',
    product_id: 'prod-1',
    quantity_units: 2.5,
    cost_price_poisha: null,
    expiry_date: null,
    occurred_at: null,
  });
  assert.ok(Array.isArray(result), '2.5 KG is a legitimate receipt; only _poisha fields are integers');
});

void test('receiveStock rejects a non-positive or non-finite quantity', () => {
  for (const quantity_units of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = receiveStock(EMPTY, {
      ctx: ctx(),
      movement_id: 'mv-1',
      product_id: 'prod-1',
      quantity_units,
      cost_price_poisha: null,
      expiry_date: null,
      occurred_at: null,
    });
    assert.ok(!Array.isArray(result), `quantity_units ${String(quantity_units)} must be rejected`);
    assert.equal(result.code, 'QUANTITY_NOT_POSITIVE');
  }
});

void test('receiveStock rejects a malformed expiry_date rather than storing a date nobody can read', () => {
  const result = receiveStock(EMPTY, {
    ctx: ctx(),
    movement_id: 'mv-1',
    product_id: 'prod-1',
    quantity_units: 5,
    cost_price_poisha: null,
    expiry_date: '31/12/2026',
    occurred_at: null,
  });
  assert.ok(!Array.isArray(result));
  assert.equal(result.code, 'INVALID_EXPIRY_DATE');
});

// ===========================================================================
// adjustStock
// ===========================================================================

void test('adjustStock handles a negative delta — this is the expiry write-off path', () => {
  const result = adjustStock(EMPTY, {
    ctx: ctx({ event_id: 'evt-a1' }),
    movement_id: 'mv-1',
    product_id: 'prod-1',
    delta_units: -4,
    reason: 'EXPIRY',
    note: 'পচে গেছে',
  });
  assert.ok(Array.isArray(result));
  const event = result[0];
  assert.ok(event !== undefined && event.type === 'STOCK_ADJUSTED');
  assert.equal(event.payload.delta_units, -4);
  assert.equal(event.payload.reason, 'EXPIRY');
  assert.equal(foldInventory(result).stock.get('prod-1')?.quantity_units, -4);
});

void test('adjustStock rejects a zero delta', () => {
  const result = adjustStock(EMPTY, {
    ctx: ctx(),
    movement_id: 'mv-1',
    product_id: 'prod-1',
    delta_units: 0,
    reason: 'COUNT_CORRECTION',
    note: null,
  });
  assert.ok(!Array.isArray(result));
  assert.equal(result.code, 'DELTA_IS_ZERO');
});

// ===========================================================================
// recordSale — the multi-event command
// ===========================================================================

function sale(overrides: Partial<RecordSaleCommand> = {}): RecordSaleCommand {
  const base: RecordSaleCommand = {
    ctxs: [],
    sale_id: 'sale-1',
    customer_id: 'cust-1',
    total_poisha: 10_000 as Poisha,
    payment_method: 'CREDIT',
    cash_paid_poisha: 0 as Poisha,
    line_items: [
      { movement_id: 'mv-1', product_id: 'prod-1', quantity_units: 2, sale_price_poisha: 5000 as Poisha },
    ],
    credit_entry_id: 'entry-1',
    note: null,
    occurred_at: 1_700_000_123_000,
  };
  const merged = { ...base, ...overrides };
  // Fill in the right number of contexts unless a test is deliberately testing
  // the mismatch path.
  return overrides.ctxs === undefined ? { ...merged, ctxs: ctxs(saleEventCount(merged)) } : merged;
}

void test('THE THREE-EVENT PATTERN: a one-item credit sale emits SALE_RECORDED + STOCK_SOLD + CREDIT_GIVEN', () => {
  const cmd = sale();
  assert.equal(saleEventCount(cmd), 3);

  const result = recordSale(EMPTY, cmd);
  assert.ok(Array.isArray(result), 'a valid credit sale must succeed');
  assert.deepEqual(
    result.map((e) => e.type),
    ['SALE_RECORDED', 'STOCK_SOLD', 'CREDIT_GIVEN'],
    'emission order is the sale, then its line items, then the credit it leaves behind',
  );

  const [saleEvent, soldEvent, creditEvent] = result;
  assert.ok(saleEvent !== undefined && soldEvent !== undefined && creditEvent !== undefined);

  // One command, one transaction: every event carries the same occurred_at,
  // which is what EVENTS.md §4 means by "in the same batch, sharing
  // occurred_at".
  for (const event of result) {
    const occurred = 'occurred_at' in event.payload ? event.payload.occurred_at : null;
    assert.equal(occurred, 1_700_000_123_000, `${event.type} must share the sale's occurred_at`);
  }

  // Each event got its own envelope — no reused id or seq, which would collide
  // on UNIQUE (device_id, seq) at insert time.
  assert.deepEqual(
    result.map((e) => e.id),
    ['evt-1', 'evt-2', 'evt-3'],
  );
  assert.deepEqual(
    result.map((e) => e.seq),
    [1, 2, 3],
  );

  if (creditEvent.type === 'CREDIT_GIVEN') {
    assert.equal(creditEvent.payload.amount_poisha, 10_000, 'the whole total becomes baki');
    assert.equal(creditEvent.payload.customer_id, 'cust-1');
    assert.equal(creditEvent.payload.entry_id, 'entry-1');
  }
  if (soldEvent.type === 'STOCK_SOLD') {
    assert.equal(soldEvent.payload.sale_id, 'sale-1', 'line items are linked back to their sale');
  }
});

void test('a cash sale emits NO CREDIT_GIVEN', () => {
  const cmd = sale({
    payment_method: 'CASH',
    cash_paid_poisha: 10_000 as Poisha,
    credit_entry_id: null,
    customer_id: null, // a walk-in
  });
  assert.equal(saleEventCount(cmd), 2);

  const result = recordSale(EMPTY, cmd);
  assert.ok(Array.isArray(result));
  assert.deepEqual(
    result.map((e) => e.type),
    ['SALE_RECORDED', 'STOCK_SOLD'],
    'nobody owes anything, so no baki is created',
  );
});

void test('a MIXED sale credits only the shortfall', () => {
  const cmd = sale({
    payment_method: 'MIXED',
    cash_paid_poisha: 4000 as Poisha,
  });
  const result = recordSale(EMPTY, cmd);
  assert.ok(Array.isArray(result));
  const credit = result.find((e) => e.type === 'CREDIT_GIVEN');
  assert.ok(credit !== undefined && credit.type === 'CREDIT_GIVEN');
  assert.equal(credit.payload.amount_poisha, 6000, '10,000 agreed minus 4,000 handed over');
});

void test('a multi-item sale emits one STOCK_SOLD per line, in the order given', () => {
  const cmd = sale({
    total_poisha: 30_000 as Poisha,
    line_items: [
      { movement_id: 'mv-1', product_id: 'prod-a', quantity_units: 1, sale_price_poisha: 10_000 as Poisha },
      { movement_id: 'mv-2', product_id: 'prod-b', quantity_units: 2, sale_price_poisha: 5000 as Poisha },
      { movement_id: 'mv-3', product_id: 'prod-c', quantity_units: 1, sale_price_poisha: 10_000 as Poisha },
    ],
  });
  assert.equal(saleEventCount(cmd), 5, '1 sale + 3 line items + 1 credit');

  const result = recordSale(EMPTY, cmd);
  assert.ok(Array.isArray(result));
  assert.equal(result.length, 5);
  const soldProducts = result
    .filter((e) => e.type === 'STOCK_SOLD')
    .map((e) => (e.type === 'STOCK_SOLD' ? e.payload.product_id : ''));
  assert.deepEqual(soldProducts, ['prod-a', 'prod-b', 'prod-c']);
});

void test('the emitted events fold into both a balance and depleted stock', () => {
  const prior: AnyEvent[] = [];
  const result = recordSale(EMPTY, sale());
  assert.ok(Array.isArray(result));

  const state = fold([...prior, ...result]);
  assert.equal(state.balances.get('cust-1')?.balance_poisha, 10_000, 'the customer now owes ৳100');
  assert.equal(state.stock.get('prod-1')?.quantity_units, -2, 'and two units left the shop');
});

// ---------------------------------------------------------------------------
// The cases that must NOT be errors
// ---------------------------------------------------------------------------

void test('NOT AN ERROR: line items that do not sum to total_poisha', () => {
  // EVENTS.md §4: the total is what the shopkeeper and the customer agreed at
  // the counter — "a fact about the past, not a cache of a calculation". If
  // they disagree, the total is what happened and the line items are wrong.
  const cmd = sale({
    total_poisha: 9500 as Poisha, // a ৳5 discount, haggled at the counter
    line_items: [
      { movement_id: 'mv-1', product_id: 'prod-1', quantity_units: 2, sale_price_poisha: 5000 as Poisha },
    ],
  });
  const result = recordSale(EMPTY, cmd);
  assert.ok(Array.isArray(result), 'a discounted sale must not be rejected for failing to reconcile');
  const saleEvent = result[0];
  assert.ok(saleEvent !== undefined && saleEvent.type === 'SALE_RECORDED');
  assert.equal(saleEvent.payload.total_poisha, 9500, 'the agreed total is recorded verbatim');
});

void test('NOT AN ERROR: selling more than the fold says is on hand', () => {
  // EVENTS.md §8: "Anomaly detection never blocks a write." The goods have
  // already left the shop; refusing to record that would lose real data.
  const prior = recordSale(EMPTY, sale({ sale_id: 'sale-0' }));
  assert.ok(Array.isArray(prior));
  const state = fold(prior);
  assert.equal(state.stock.get('prod-1')?.quantity_units, -2, 'already negative');

  const again = recordSale(state, sale({ sale_id: 'sale-2', credit_entry_id: 'entry-2' }));
  assert.ok(Array.isArray(again), 'overselling must still be recorded, then surfaced as an anomaly');

  const after = fold([...prior, ...again]);
  const anomalies = detectAnomalies(after, [...prior, ...again]);
  assert.ok(
    anomalies.some((a) => a.kind === 'NEGATIVE_STOCK'),
    'it becomes an anomaly after the fold, not a rejection before it',
  );
});

void test('NOT AN ERROR: a sale for a product that has no PRODUCT_ADDED yet', () => {
  // Same precedent as applyCredit not checking the customer exists: under
  // offline sync the defining event may simply not have arrived on this device.
  const result = recordSale(EMPTY, sale({ line_items: [
    { movement_id: 'mv-1', product_id: 'never-seen', quantity_units: 1, sale_price_poisha: 10_000 as Poisha },
  ] }));
  assert.ok(Array.isArray(result));
});

// ---------------------------------------------------------------------------
// The cases that MUST be errors
// ---------------------------------------------------------------------------

void test('recordSale rejects an empty sale', () => {
  const result = recordSale(EMPTY, sale({ line_items: [] }));
  assert.ok(!Array.isArray(result));
  assert.equal(result.code, 'NO_LINE_ITEMS');
});

void test('recordSale rejects a zero total — a giveaway is STOCK_ADJUSTED with reason GIFT', () => {
  const result = recordSale(EMPTY, sale({
    total_poisha: 0 as Poisha,
    payment_method: 'CASH',
    cash_paid_poisha: 0 as Poisha,
    credit_entry_id: null,
  }));
  assert.ok(!Array.isArray(result));
  assert.equal(result.code, 'AMOUNT_NOT_POSITIVE');
});

void test('recordSale rejects cash paid above the agreed total', () => {
  const result = recordSale(EMPTY, sale({
    payment_method: 'CASH',
    cash_paid_poisha: 15_000 as Poisha,
    credit_entry_id: null,
  }));
  assert.ok(!Array.isArray(result));
  assert.equal(result.code, 'CASH_PAID_OUT_OF_RANGE');
});

void test('recordSale rejects a payment_method that contradicts the numbers', () => {
  // Without this check a CASH sale that was only half paid would silently emit
  // a CREDIT_GIVEN, putting a debt on a customer the shopkeeper believes
  // settled up.
  const cashButShort = recordSale(EMPTY, sale({
    payment_method: 'CASH',
    cash_paid_poisha: 4000 as Poisha,
  }));
  assert.ok(!Array.isArray(cashButShort));
  assert.equal(cashButShort.code, 'PAYMENT_METHOD_INCONSISTENT');

  const creditButPaid = recordSale(EMPTY, sale({
    payment_method: 'CREDIT',
    cash_paid_poisha: 4000 as Poisha,
  }));
  assert.ok(!Array.isArray(creditButPaid));
  assert.equal(creditButPaid.code, 'PAYMENT_METHOD_INCONSISTENT');

  const mixedButFullyPaid = recordSale(EMPTY, sale({
    payment_method: 'MIXED',
    cash_paid_poisha: 10_000 as Poisha,
  }));
  assert.ok(!Array.isArray(mixedButFullyPaid));
  assert.equal(mixedButFullyPaid.code, 'PAYMENT_METHOD_INCONSISTENT');
});

void test('recordSale rejects credit owed by a walk-in', () => {
  const result = recordSale(EMPTY, sale({ customer_id: null }));
  assert.ok(!Array.isArray(result));
  assert.equal(result.code, 'CUSTOMER_REQUIRED_FOR_CREDIT');
});

void test('recordSale rejects a credit sale with no credit_entry_id', () => {
  const result = recordSale(EMPTY, sale({ credit_entry_id: null }));
  assert.ok(!Array.isArray(result));
  assert.equal(result.code, 'CREDIT_ENTRY_ID_REQUIRED');
});

void test('recordSale rejects a context count mismatch rather than reusing a seq', () => {
  const tooFew = recordSale(EMPTY, sale({ ctxs: ctxs(2) }));
  assert.ok(!Array.isArray(tooFew));
  assert.equal(tooFew.code, 'CONTEXT_COUNT_MISMATCH');
  assert.match(tooFew.message, /exactly 3/, 'the error says how many were needed');

  const tooMany = recordSale(EMPTY, sale({ ctxs: ctxs(4) }));
  assert.ok(!Array.isArray(tooMany));
  assert.equal(tooMany.code, 'CONTEXT_COUNT_MISMATCH');
});

void test('recordSale rejects a non-positive line quantity', () => {
  const result = recordSale(EMPTY, sale({ line_items: [
    { movement_id: 'mv-1', product_id: 'prod-1', quantity_units: 0, sale_price_poisha: 5000 as Poisha },
  ] }));
  assert.ok(!Array.isArray(result));
  assert.equal(result.code, 'QUANTITY_NOT_POSITIVE');
});

// ---------------------------------------------------------------------------
// Property: saleEventCount always matches what recordSale actually emits
// ---------------------------------------------------------------------------

void test('saleEventCount always predicts the emitted length exactly (property)', () => {
  const RUNS = 100;
  let checked = 0;
  for (let seed = 0; seed < RUNS; seed++) {
    const lineCount = (seed % 4) + 1;
    const total = ((seed % 9) + 1) * 1000;
    // Cycle through all three payment methods and their matching cash splits.
    const method = (['CASH', 'CREDIT', 'MIXED'] as const)[seed % 3] ?? 'CASH';
    const cash = method === 'CASH' ? total : method === 'CREDIT' ? 0 : Math.floor(total / 2);
    if (method === 'MIXED' && (cash === 0 || cash >= total)) continue; // not a MIXED sale

    const cmd = sale({
      total_poisha: total as Poisha,
      payment_method: method,
      cash_paid_poisha: cash as Poisha,
      customer_id: method === 'CASH' ? null : 'cust-1',
      credit_entry_id: method === 'CASH' ? null : 'entry-1',
      line_items: Array.from({ length: lineCount }, (_, i) => ({
        movement_id: `mv-${i}`,
        product_id: `prod-${i}`,
        quantity_units: i + 1,
        sale_price_poisha: 100 as Poisha,
      })),
    });

    const result = recordSale(EMPTY, cmd);
    assert.ok(Array.isArray(result), `seed ${seed}: ${method} sale of ${total} was rejected`);
    assert.equal(result.length, saleEventCount(cmd), `seed ${seed}: predicted count did not match`);
    // Every envelope is distinct — the seq-collision guarantee.
    assert.equal(new Set(result.map((e) => e.id)).size, result.length, `seed ${seed}: duplicate event id`);
    assert.equal(new Set(result.map((e) => e.seq)).size, result.length, `seed ${seed}: duplicate seq`);
    checked++;
  }
  console.log(`  saleEventCount agreement: ${checked} of ${RUNS} generated sales`);
});

void test('commands never throw, whatever they are handed (property)', () => {
  const RUNS = 100;
  for (let seed = 0; seed < RUNS; seed++) {
    const weird = (seed % 5) - 2; // -2, -1, 0, 1, 2
    assert.doesNotThrow(() =>
      addProduct(EMPTY, {
        ctx: ctx(),
        product_id: 'p',
        name: seed % 2 === 0 ? '' : 'x',
        unit: 'PIECE',
        sale_price_poisha: weird as Poisha,
        low_stock_threshold_units: weird,
      }),
    );
    assert.doesNotThrow(() =>
      receiveStock(EMPTY, {
        ctx: ctx(),
        movement_id: 'm',
        product_id: 'p',
        quantity_units: weird,
        cost_price_poisha: weird as Poisha,
        expiry_date: seed % 3 === 0 ? 'garbage' : null,
        occurred_at: null,
      }),
    );
    assert.doesNotThrow(() => adjustStock(EMPTY, {
      ctx: ctx(), movement_id: 'm', product_id: 'p', delta_units: weird, reason: 'OTHER', note: null,
    }));
    assert.doesNotThrow(() =>
      recordSale(EMPTY, {
        ctxs: ctxs(Math.abs(weird)),
        sale_id: 's',
        customer_id: seed % 2 === 0 ? null : 'c',
        total_poisha: (weird * 100) as Poisha,
        payment_method: 'MIXED',
        cash_paid_poisha: weird as Poisha,
        line_items: [
          { movement_id: 'm', product_id: 'p', quantity_units: weird, sale_price_poisha: 1 as Poisha },
        ],
        credit_entry_id: null,
        note: null,
        occurred_at: null,
      }),
    );
  }
  console.log(`  errors-are-values: ${RUNS} hostile inputs across four commands, no throws`);
});
