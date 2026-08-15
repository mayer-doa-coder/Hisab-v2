// testEventStore.ts — shared test setup, not a test file itself (no
// test() calls). Wires a fresh sql.js-backed Database + schema + a
// deterministic Clock/UUID source into a real EventStore.

import { openSqlJsDatabase } from './sqlJsDb';
import { ALL_SCHEMA_SQL } from '../src/data/schema';
import { Clock } from '../src/data/clock';
import { createEventStore, type EventStore } from '../src/data/eventStore';
import type { Database } from '../src/data/db';

/** Deterministic, not cryptographically random — fine for tests, never for real use. */
export function seededRandomBytes(seed: number): (n: number) => Uint8Array {
  let state = seed;
  return (n: number) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      out[i] = state & 0xff;
    }
    return out;
  };
}

export interface TestStore {
  readonly db: Database;
  readonly store: EventStore;
  readonly deviceId: string;
}

export async function createTestStore(deviceId = 'test-device-1', seed = 1): Promise<TestStore> {
  const db = await openSqlJsDatabase();
  await db.execAsync(ALL_SCHEMA_SQL);

  let clockTime = 1_700_000_000_000;
  const clock = new Clock(deviceId, undefined, () => {
    clockTime += 1;
    return clockTime;
  });

  const store = createEventStore({
    db,
    deviceId,
    shopId: 'shop-1',
    clock,
    getRandomBytes: seededRandomBytes(seed),
    now: () => {
      clockTime += 1;
      return clockTime;
    },
  });

  return { db, store, deviceId };
}
