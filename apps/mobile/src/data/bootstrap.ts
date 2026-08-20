// bootstrap.ts — the real device wiring db.expo.ts's own header says nothing
// does yet: open the database, run the schema, get-or-create device_id and
// shop_id, build the HLC clock, construct the EventStore. App.tsx calls this
// once at cold start and passes the result down as plain props — not a
// context. One storage handle every screen needs is not the "~80 memoised
// functions over every entity" AGENTS.md §4.2 forbids; it is the same shape
// eventStore.ts already is.
//
// shop_id: there is no login screen yet (BUILD_PLAN.md Phase 2 is explicit —
// "Still no network" — and nothing in apps/mobile calls the server's auth
// endpoints). A shop, like a device, gets a stable id generated once and
// persisted via expo-secure-store (deviceId.ts's own pattern, generalized
// into getOrCreateId for exactly this reuse), not asked for at a screen that
// does not exist yet. Replace this with the real shop identity once Phase 3
// auth is wired into the client.

import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { createDeviceClock } from './clock';
import { openExpoDatabase } from './db.expo';
import { getOrCreateDeviceId, getOrCreateId } from './deviceId';
import { createEventStore, type EventStore } from './eventStore';
import { ALL_SCHEMA_SQL } from './schema';
import { createTimingLogger, type TimingLogger } from './timing';
import type { Database } from './db';

const SHOP_ID_KEY = 'hisab.shop_id';
const DATABASE_NAME = 'hisab.db';

export interface AppData {
  readonly db: Database;
  readonly store: EventStore;
  readonly deviceId: string;
  readonly shopId: string;
  readonly timingLogger: TimingLogger;
  readonly getRandomBytes: (byteCount: number) => Uint8Array;
}

function generateUuidLike(): string {
  // Only used as the seed material's own identity (a device_id/shop_id
  // string), never as an event id — those go through uuid.ts's real
  // UUIDv7. expo-crypto's own v4 UUID is exactly right for this: a stable,
  // opaque local identifier, not an event envelope field.
  return Crypto.randomUUID();
}

export async function bootstrap(): Promise<AppData> {
  const db = await openExpoDatabase(DATABASE_NAME);
  await db.execAsync(ALL_SCHEMA_SQL);

  const deviceId = await getOrCreateDeviceId(SecureStore, generateUuidLike);
  const shopId = await getOrCreateId(SecureStore, SHOP_ID_KEY, generateUuidLike);

  const clock = await createDeviceClock(db, deviceId);
  const getRandomBytes = Crypto.getRandomBytes;

  const store = createEventStore({ db, deviceId, shopId, clock, getRandomBytes });
  const timingLogger = createTimingLogger(db, deviceId);

  return { db, store, deviceId, shopId, timingLogger, getRandomBytes };
}
