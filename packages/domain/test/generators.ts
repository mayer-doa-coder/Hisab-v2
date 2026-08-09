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
