// device.ts — one simulated device for the convergence test. Shared setup,
// not a test file.
//
// Every part of this is the real thing: the real sql.js-backed event store
// (apps/mobile/src/data/eventStore.ts, Step 7), the real HLC clock
// (clock.ts, Step 7), the real sync engine and HTTP client
// (apps/mobile/src/sync/, this step), against the real server
// (server/src/, this step) on a real Postgres. Nothing is mocked. A
// convergence test with a fake server or a fake store would prove nothing
// about convergence.
//
// The only substitutions are the ones that cannot run in a Node process at
// all: sql.js instead of expo-sqlite, and an in-memory token store instead of
// expo-secure-store. Both are storage backends behind the same interfaces the
// app uses, not reimplementations of any logic.

import { openSqlJsDatabase } from '../../apps/mobile/test/sqlJsDb';
import { ALL_SCHEMA_SQL } from '../../apps/mobile/src/data/schema';
import { Clock } from '../../apps/mobile/src/data/clock';
import { createEventStore, type EventStore } from '../../apps/mobile/src/data/eventStore';
import type { Database } from '../../apps/mobile/src/data/db';
import { Api, type AuthTokens } from '../../apps/mobile/src/sync/api';
import { createMemoryTokenStore } from '../../apps/mobile/src/sync/memoryTokenStore';
import { SyncEngine } from '../../apps/mobile/src/sync/syncEngine';

/** Deterministic, not cryptographically random. Same helper as apps/mobile/test/testEventStore.ts. */
function seededRandomBytes(seed: number): (n: number) => Uint8Array {
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

export interface SimulatedDevice {
  readonly deviceId: string;
  readonly db: Database;
  readonly store: EventStore;
  readonly engine: SyncEngine;
  readonly clock: Clock;
}

export interface DeviceOptions {
  readonly deviceId: string;
  readonly shopId: string;
  readonly baseUrl: string;
  readonly tokens: AuthTokens;
  /**
   * Each device gets its own physical-clock base. Device B's is deliberately
   * offset so the two are NOT in lockstep — identical clocks would make
   * ordering accidentally stable and hide any real dependency on wall time.
   */
  readonly clockStart: number;
  readonly randomSeed: number;
}

export async function createDevice(options: DeviceOptions): Promise<SimulatedDevice> {
  const db = await openSqlJsDatabase();
  await db.execAsync(ALL_SCHEMA_SQL);

  let physical = options.clockStart;
  const advance = (): number => {
    physical += 1;
    return physical;
  };

  const clock = new Clock(options.deviceId, undefined, advance);

  const store = createEventStore({
    db,
    deviceId: options.deviceId,
    shopId: options.shopId,
    clock,
    getRandomBytes: seededRandomBytes(options.randomSeed),
    now: advance,
  });

  const engine = new SyncEngine({
    api: new Api({ baseUrl: options.baseUrl }),
    store,
    tokens: createMemoryTokenStore(options.tokens),
    // Reuses the same identity as the event-log device_id — exactly what the
    // real app does (apps/mobile/src/data/deviceId.ts is one stable id used
    // for both purposes), not a harness shortcut.
    deviceFingerprint: options.deviceId,
    // Real wall clock here, not the simulated one: this is only used to
    // decide whether the ACCESS token has expired, which is a real-time
    // question about a real token the real server issued.
    now: Date.now,
    // No actual waiting in tests. The backoff policy itself is unit-tested
    // separately; making the convergence test sleep would only make it slow.
    sleep: () => Promise.resolve(),
  });

  return { deviceId: options.deviceId, db, store, engine, clock };
}
