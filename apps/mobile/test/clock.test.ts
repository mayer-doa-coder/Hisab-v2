// clock.test.ts — the HLC algorithm had no permanent test at all before
// this audit; correctness was checked by hand with a throwaway script and
// thrown away. fold.ts's sort correctness depends entirely on encodeHlc
// producing strings whose lexicographic order matches logical HLC order —
// that property is the one most worth pinning down here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tick, encodeHlc, decodeHlc, ZERO_HLC_STATE, Clock, createDeviceClock } from '../src/data/clock.ts';
import { openSqlJsDatabase } from './sqlJsDb.ts';
import { ALL_SCHEMA_SQL } from '../src/data/schema.ts';

void test('tick advances l to physicalNow and resets c when l moves forward', () => {
  const s1 = tick(ZERO_HLC_STATE, 1000);
  assert.deepStrictEqual(s1, { l: 1000, c: 0 });

  const s2 = tick(s1, 2000);
  assert.deepStrictEqual(s2, { l: 2000, c: 0 });
});

void test('tick increments c, not l, when physicalNow does not advance (same-ms events)', () => {
  const s1 = tick(ZERO_HLC_STATE, 1000);
  const s2 = tick(s1, 1000); // clock hasn't moved
  const s3 = tick(s2, 1000);
  assert.deepStrictEqual(s2, { l: 1000, c: 1 });
  assert.deepStrictEqual(s3, { l: 1000, c: 2 });
});

void test('tick never regresses l when physicalNow goes backward (clock skew)', () => {
  const s1 = tick(ZERO_HLC_STATE, 5000);
  const s2 = tick(s1, 1000); // physical clock jumped backward
  assert.equal(s2.l, 5000, 'l must stay at the max ever observed, not regress');
  assert.equal(s2.c, 1, 'c increments since l did not advance');
});

void test('encodeHlc/decodeHlc round-trip exactly', () => {
  const state = { l: 1_786_351_553_548, c: 42 };
  const encoded = encodeHlc(state, 'device-abc');
  const decoded = decodeHlc(encoded);
  assert.deepStrictEqual(decoded, { l: state.l, c: state.c, deviceId: 'device-abc' });
});

void test('encodeHlc string order matches logical HLC order — fold.ts sorts by this', () => {
  const earlier = encodeHlc({ l: 1000, c: 5 }, 'device-a');
  const later = encodeHlc({ l: 1000, c: 6 }, 'device-a'); // same l, higher c
  const muchLater = encodeHlc({ l: 1001, c: 0 }, 'device-a'); // higher l, lower c

  assert.ok(earlier < later, 'higher c at the same l must sort after');
  assert.ok(later < muchLater, 'higher l must sort after regardless of c');
});

void test('Clock.next() produces strictly increasing encoded strings across many ticks', () => {
  let t = 1_700_000_000_000;
  const clock = new Clock('device-x', ZERO_HLC_STATE, () => {
    t += Math.floor(Math.random() * 3); // sometimes advances, sometimes doesn't
    return t;
  });

  let previous = clock.next();
  for (let i = 0; i < 200; i++) {
    const current = clock.next();
    assert.ok(current > previous, `hlc must strictly increase: ${previous} then ${current}`);
    previous = current;
  }
});

// ---------------------------------------------------------------------------
// createDeviceClock — the bootstrap fix found during audit. Before this fix,
// nothing ever called Clock's initialState parameter with a real value, so
// a fresh Clock after a restart always started at ZERO_HLC_STATE regardless
// of what this device had already written.
// ---------------------------------------------------------------------------

void test('createDeviceClock seeds from this device\'s own last hlc, not from zero', async () => {
  const db = await openSqlJsDatabase();
  await db.execAsync(ALL_SCHEMA_SQL);

  // Simulate a prior session having already written an event with a hlc
  // whose l is far in the future relative to what "now" will report below —
  // e.g. a device whose clock was briefly fast, then corrected.
  const futureHlc = encodeHlc({ l: 9_999_999_999_999, c: 3 }, 'device-restart');
  await db.runAsync(
    `INSERT INTO events (id, device_id, seq, hlc, shop_id, type, payload, created_at, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['evt-1', 'device-restart', 1, futureHlc, 'shop-1', 'CUSTOMER_ADDED', '{}', 1000, null],
  );

  // "Restart": construct a brand-new Clock via the bootstrap helper, with a
  // physical clock that reports a much smaller, ordinary current time.
  const clock = await createDeviceClock(db, 'device-restart', () => 1_700_000_000_000);
  const nextHlc = clock.next();

  assert.ok(
    nextHlc > futureHlc,
    `bootstrapped clock must produce an hlc after this device's last one; got ${nextHlc} after ${futureHlc}`,
  );
});

void test('createDeviceClock starts at ZERO_HLC_STATE for a device with no prior events', async () => {
  const db = await openSqlJsDatabase();
  await db.execAsync(ALL_SCHEMA_SQL);

  const clock = await createDeviceClock(db, 'brand-new-device', () => 1_700_000_000_000);
  const first = clock.next();
  const decoded = decodeHlc(first);
  assert.equal(decoded.l, 1_700_000_000_000);
  assert.equal(decoded.c, 0);
});
