// generators.ts — shared test infrastructure, not a test file itself (no
// `test()` calls here). Split out from fold.test.ts so anomalies.test.ts can
// reuse the random-sequence generator without re-executing fold.test.ts's
// own test registrations as a side effect of importing it (Node re-runs a
// module's top-level code, including test() calls, on every import).

import type { AnyEvent, Poisha } from '../src/types.ts';

// ---------------------------------------------------------------------------
// A tiny seeded PRNG so failures are reproducible from the seed alone.
// ---------------------------------------------------------------------------
export function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: readonly T[], rand: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const a = copy[i];
    const b = copy[j];
    if (a === undefined || b === undefined) {
      throw new Error('unreachable: i and j are always valid indices into copy');
    }
    copy[i] = b;
    copy[j] = a;
  }
  return copy;
}

// ---------------------------------------------------------------------------
// Random valid event sequence generator. Deterministic given a seed: a single
// global counter drives both `hlc` (zero-padded so lexicographic order equals
// generation order) and a synthetic `created_at`, so no wall clock is read.
// ---------------------------------------------------------------------------
export function randomAmount(rand: () => number): Poisha {
  return (Math.floor(rand() * 100000) + 100) as Poisha;
}

export function generateSequence(seed: number, steps: number): AnyEvent[] {
  const rand = mulberry32(seed);
  const events: AnyEvent[] = [];
  const customerIds: string[] = [];
  const voidableIds: string[] = [];
  let counter = 0;

  const nextEnvelope = () => {
    counter += 1;
    return {
      id: `evt-${seed}-${counter}`,
      device_id: rand() < 0.5 ? 'device-a' : 'device-b',
      seq: counter,
      hlc: String(counter).padStart(8, '0'),
      shop_id: 'shop-1',
      created_at: 1_700_000_000_000 + counter * 1000,
      synced_at: null,
    };
  };

  for (let i = 0; i < steps; i++) {
    const envelope = nextEnvelope();
    const occurred_at = rand() < 0.2 ? envelope.created_at - Math.floor(rand() * 5000) : null;

    if (customerIds.length === 0 || rand() < 0.25) {
      const customer_id = `customer-${seed}-${customerIds.length}`;
      customerIds.push(customer_id);
      const event: AnyEvent = {
        ...envelope,
        type: 'CUSTOMER_ADDED',
        payload: {
          schema_version: 1,
          customer_id,
          display_name: `Customer ${customerIds.length}`,
          phone: null,
        },
      };
      events.push(event);
      voidableIds.push(event.id);
      continue;
    }

    const pickedCustomerId = customerIds[Math.floor(rand() * customerIds.length)];
    if (pickedCustomerId === undefined) {
      throw new Error('unreachable: customerIds is non-empty in this branch');
    }
    const customer_id = pickedCustomerId;
    const roll = rand();

    let event: AnyEvent;
    if (roll < 0.4) {
      event = {
        ...envelope,
        type: 'CREDIT_GIVEN',
        payload: {
          schema_version: 1,
          entry_id: `entry-${seed}-${counter}`,
          customer_id,
          amount_poisha: randomAmount(rand),
          note: null,
          occurred_at,
        },
      };
    } else if (roll < 0.7) {
      event = {
        ...envelope,
        type: 'PAYMENT_RECEIVED',
        payload: {
          schema_version: 1,
          entry_id: `entry-${seed}-${counter}`,
          customer_id,
          amount_poisha: randomAmount(rand),
          note: null,
          occurred_at,
        },
      };
    } else if (roll < 0.8) {
      event = {
        ...envelope,
        type: 'CUSTOMER_RENAMED',
        payload: { schema_version: 1, customer_id, display_name: `Renamed ${counter}` },
      };
    } else if (roll < 0.85) {
      event = {
        ...envelope,
        type: 'CUSTOMER_ARCHIVED',
        payload: { schema_version: 1, customer_id, reason: 'INACTIVE' },
      };
    } else if (voidableIds.length > 0) {
      const pickedTarget = voidableIds[Math.floor(rand() * voidableIds.length)];
      if (pickedTarget === undefined) {
        throw new Error('unreachable: voidableIds is non-empty in this branch');
      }
      const target = pickedTarget;
      event = {
        ...envelope,
        type: 'ENTRY_VOIDED',
        payload: { schema_version: 1, voids_event_id: target, reason: 'MISTAKE' },
      };
    } else {
      event = {
        ...envelope,
        type: 'CREDIT_GIVEN',
        payload: {
          schema_version: 1,
          entry_id: `entry-${seed}-${counter}`,
          customer_id,
          amount_poisha: randomAmount(rand),
          note: null,
          occurred_at,
        },
      };
    }

    events.push(event);
    if (event.type !== 'ENTRY_VOIDED') {
      voidableIds.push(event.id);
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// Inventory sequence generator — Step 12. Separate from generateSequence()
// rather than folded into it, so fold.test.ts's existing property assertions
// keep running against exactly the six core events they were written for.
//
// Same determinism contract: a single counter drives hlc and created_at, no
// wall clock is read, and a seed reproduces a run exactly.
// ---------------------------------------------------------------------------
export function generateInventorySequence(seed: number, steps: number): AnyEvent[] {
  const rand = mulberry32(seed + 500_000);
  const events: AnyEvent[] = [];
  const productIds: string[] = [];
  const voidableIds: string[] = [];
  let counter = 0;

  const nextEnvelope = () => {
    counter += 1;
    return {
      id: `inv-${seed}-${counter}`,
      device_id: rand() < 0.5 ? 'device-a' : 'device-b',
      seq: counter,
      hlc: String(counter).padStart(8, '0'),
      shop_id: 'shop-1',
      created_at: 1_700_000_000_000 + counter * 1000,
      synced_at: rand() < 0.5 ? null : 1_700_000_500_000,
    };
  };

  const units = ['PIECE', 'KG', 'GRAM', 'LITRE', 'ML', 'PACKET', 'DOZEN'] as const;

  for (let i = 0; i < steps; i++) {
    const envelope = nextEnvelope();
    const occurred_at = rand() < 0.2 ? envelope.created_at - Math.floor(rand() * 5000) : null;

    if (productIds.length === 0 || rand() < 0.2) {
      const product_id = `product-${seed}-${productIds.length}`;
      productIds.push(product_id);
      const unit = units[Math.floor(rand() * units.length)] ?? 'PIECE';
      const event: AnyEvent = {
        ...envelope,
        type: 'PRODUCT_ADDED',
        payload: {
          schema_version: 1,
          product_id,
          name: `Product ${productIds.length}`,
          unit,
          sale_price_poisha: randomAmount(rand),
          low_stock_threshold_units: rand() < 0.5 ? Math.floor(rand() * 10) : null,
        },
      };
      events.push(event);
      voidableIds.push(event.id);
      continue;
    }

    const picked = productIds[Math.floor(rand() * productIds.length)];
    if (picked === undefined) {
      throw new Error('unreachable: productIds is non-empty in this branch');
    }
    const product_id = picked;
    const roll = rand();

    let event: AnyEvent;
    if (roll < 0.35) {
      event = {
        ...envelope,
        type: 'STOCK_RECEIVED',
        payload: {
          schema_version: 1,
          movement_id: `mv-${seed}-${counter}`,
          product_id,
          quantity_units: Math.floor(rand() * 50) + 1,
          cost_price_poisha: randomAmount(rand),
          // A mix of null, already-expired and far-future dates, so
          // expiryRisks() sees all three in a property run.
          expiry_date: rand() < 0.4 ? null : rand() < 0.5 ? '2020-01-15' : '2099-12-31',
          occurred_at,
        },
      };
    } else if (roll < 0.65) {
      event = {
        ...envelope,
        type: 'STOCK_SOLD',
        payload: {
          schema_version: 1,
          movement_id: `mv-${seed}-${counter}`,
          product_id,
          quantity_units: Math.floor(rand() * 20) + 1,
          sale_price_poisha: randomAmount(rand),
          sale_id: `sale-${seed}-${counter}`,
          occurred_at,
        },
      };
    } else if (roll < 0.78) {
      event = {
        ...envelope,
        type: 'STOCK_ADJUSTED',
        payload: {
          schema_version: 1,
          movement_id: `mv-${seed}-${counter}`,
          product_id,
          delta_units: (rand() < 0.5 ? -1 : 1) * (Math.floor(rand() * 8) + 1),
          reason: rand() < 0.5 ? 'DAMAGE' : 'COUNT_CORRECTION',
          note: null,
        },
      };
    } else if (roll < 0.86) {
      event = {
        ...envelope,
        type: 'PRODUCT_UPDATED',
        payload: {
          schema_version: 1,
          product_id,
          name: `Renamed ${counter}`,
          ...(rand() < 0.5 ? { low_stock_threshold_units: Math.floor(rand() * 10) } : {}),
        },
      };
    } else if (roll < 0.9) {
      event = {
        ...envelope,
        type: 'PRODUCT_ARCHIVED',
        payload: { schema_version: 1, product_id },
      };
    } else if (voidableIds.length > 0) {
      const target = voidableIds[Math.floor(rand() * voidableIds.length)];
      if (target === undefined) {
        throw new Error('unreachable: voidableIds is non-empty in this branch');
      }
      event = {
        ...envelope,
        type: 'ENTRY_VOIDED',
        payload: { schema_version: 1, voids_event_id: target, reason: 'MISTAKE' },
      };
    } else {
      event = {
        ...envelope,
        type: 'STOCK_RECEIVED',
        payload: {
          schema_version: 1,
          movement_id: `mv-${seed}-${counter}`,
          product_id,
          quantity_units: Math.floor(rand() * 50) + 1,
          cost_price_poisha: null,
          expiry_date: null,
          occurred_at,
        },
      };
    }

    events.push(event);
    if (event.type !== 'ENTRY_VOIDED') {
      voidableIds.push(event.id);
    }
  }

  return events;
}
