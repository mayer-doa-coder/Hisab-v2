// timing.test.ts — proves the instrumentation itself works: a real
// timestamp pair gets logged and a real duration comes back. This is not
// "walking through the credit-entry screen" (it doesn't exist yet — Step 8)
// — it's calling exactly the two functions a screen would call, at the
// points a screen would call them, and checking the persisted result.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openSqlJsDatabase } from './sqlJsDb.ts';
import { ALL_SCHEMA_SQL } from '../src/data/schema.ts';
import { createTimingLogger, getFlowDurations } from '../src/data/timing.ts';

void test('logging start then confirm produces one real timestamp pair and duration', async () => {
  const db = await openSqlJsDatabase();
  await db.execAsync(ALL_SCHEMA_SQL);

  let clock = 1_700_000_000_000;
  const logger = createTimingLogger(db, 'device-1', () => clock);

  // Simulates a screen calling log('credit_entry', 'start') on entering the
  // Who? step, and log('credit_entry', 'confirm') on the confirm tap —
  // exactly the two call sites Step 8 will add, walked through once here.
  await logger.log('credit_entry', 'start');
  clock += 6500; // 6.5s later — under the 8s acceptance criterion
  await logger.log('credit_entry', 'confirm');

  const rows = await db.getAllAsync('SELECT * FROM timing_log ORDER BY occurred_at', []);
  assert.equal(rows.length, 2, 'both the start and confirm timestamps must be persisted');

  const durations = await getFlowDurations(db, 'credit_entry');
  assert.equal(durations.length, 1);
  assert.equal(durations[0]?.durationMs, 6500);
  assert.equal(durations[0]?.startedAt, 1_700_000_000_000);
  assert.equal(durations[0]?.confirmedAt, 1_700_000_006_500);
});

void test('an abandoned flow (start with no confirm) is not reported as a duration', async () => {
  const db = await openSqlJsDatabase();
  await db.execAsync(ALL_SCHEMA_SQL);
  const logger = createTimingLogger(db, 'device-1', () => 1_700_000_000_000);

  await logger.log('credit_entry', 'start');
  // App killed / user backed out — no confirm ever logged.

  const durations = await getFlowDurations(db, 'credit_entry');
  assert.equal(durations.length, 0, 'an incomplete flow must not be counted as a measurement');
});

void test('multiple completed flows are all paired correctly, in order', async () => {
  const db = await openSqlJsDatabase();
  await db.execAsync(ALL_SCHEMA_SQL);

  let clock = 1_700_000_000_000;
  const logger = createTimingLogger(db, 'device-1', () => clock);

  await logger.log('credit_entry', 'start');
  clock += 5000;
  await logger.log('credit_entry', 'confirm');
  clock += 100_000; // a later, unrelated entry
  await logger.log('credit_entry', 'start');
  clock += 9000; // over the 8s target — real data should show this, not hide it
  await logger.log('credit_entry', 'confirm');

  const durations = await getFlowDurations(db, 'credit_entry');
  assert.deepStrictEqual(
    durations.map((d) => d.durationMs),
    [5000, 9000],
  );
});

void test('different flows do not interfere with each other', async () => {
  const db = await openSqlJsDatabase();
  await db.execAsync(ALL_SCHEMA_SQL);
  let clock = 1_700_000_000_000;
  const logger = createTimingLogger(db, 'device-1', () => clock);

  await logger.log('credit_entry', 'start');
  clock += 3000;
  await logger.log('payment_entry', 'start'); // a different flow starts in between
  clock += 2000;
  await logger.log('credit_entry', 'confirm');
  clock += 1000;
  await logger.log('payment_entry', 'confirm');

  const creditDurations = await getFlowDurations(db, 'credit_entry');
  const paymentDurations = await getFlowDurations(db, 'payment_entry');
  assert.equal(creditDurations[0]?.durationMs, 5000);
  assert.equal(paymentDurations[0]?.durationMs, 3000);
});
