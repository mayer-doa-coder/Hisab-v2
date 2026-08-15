// rebuild.test.ts — THE REBUILD INVARIANT (docs/EVENTS.md §7: "must always
// pass"). Apply a random sequence of commands via append(), record the
// resulting projections; separately, drop projections and call
// rebuildProjections(); assert byte-identical state between the two.
//
// This is the one test that would catch the v1 bug (Customer.currentDue
// drift) if append()'s balance update were ever changed from a re-fold to
// an in-place increment — see this step's report for the deliberately
// broken run that proves it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestStore } from './testEventStore.ts';
import type { EventStore } from '../src/data/eventStore.ts';
import type { Database } from '../src/data/db.ts';
import type { EventType } from '@hisab/domain';

// ---------------------------------------------------------------------------
// A tiny seeded PRNG — same algorithm as packages/domain/test/fold.test.ts's
// mulberry32, reimplemented here rather than imported across the workspace
// boundary (domain's test/ directory is not part of its public surface).
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Command {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

/** Random valid (type, payload) commands — no envelope fields; append() builds those. */
function generateCommands(seed: number, steps: number): Command[] {
  const rand = mulberry32(seed);
  const commands: Command[] = [];
  const customerIds: string[] = [];
  const voidableEntryIds: string[] = [];
  let counter = 0;

  for (let i = 0; i < steps; i++) {
    counter += 1;

    if (customerIds.length === 0 || rand() < 0.25) {
      const customerId = `customer-${seed}-${customerIds.length}`;
      customerIds.push(customerId);
      commands.push({
        type: 'CUSTOMER_ADDED',
        payload: { schema_version: 1, customer_id: customerId, display_name: `Customer ${customerIds.length}`, phone: null },
      });
      continue;
    }

    const customerId = customerIds[Math.floor(rand() * customerIds.length)];
    if (customerId === undefined) throw new Error('unreachable: customerIds is non-empty here');
    const roll = rand();
    const entryId = `entry-${seed}-${counter}`;

    if (roll < 0.4) {
      commands.push({
        type: 'CREDIT_GIVEN',
        payload: { schema_version: 1, entry_id: entryId, customer_id: customerId, amount_poisha: Math.floor(rand() * 100000) + 100, note: null, occurred_at: null },
      });
      voidableEntryIds.push(entryId);
    } else if (roll < 0.7) {
      commands.push({
        type: 'PAYMENT_RECEIVED',
        payload: { schema_version: 1, entry_id: entryId, customer_id: customerId, amount_poisha: Math.floor(rand() * 100000) + 100, note: null, occurred_at: null },
      });
      voidableEntryIds.push(entryId);
    } else if (roll < 0.8) {
      commands.push({
        type: 'CUSTOMER_RENAMED',
        payload: { schema_version: 1, customer_id: customerId, display_name: `Renamed ${counter}` },
      });
    } else if (roll < 0.85) {
      commands.push({
        type: 'CUSTOMER_ARCHIVED',
        payload: { schema_version: 1, customer_id: customerId, reason: 'INACTIVE' },
      });
    } else if (voidableEntryIds.length > 0) {
      // Void by entry_id here, resolved to the underlying event id after
      // append() below — see resolveVoidTargets in the test bodies.
      commands.push({
        type: 'ENTRY_VOIDED',
        payload: { schema_version: 1, __voids_entry_id: voidableEntryIds[Math.floor(rand() * voidableEntryIds.length)], reason: 'MISTAKE' },
      });
    } else {
      commands.push({
        type: 'CREDIT_GIVEN',
        payload: { schema_version: 1, entry_id: entryId, customer_id: customerId, amount_poisha: Math.floor(rand() * 100000) + 100, note: null, occurred_at: null },
      });
      voidableEntryIds.push(entryId);
    }
  }

  return commands;
}

/** Snapshots both projection tables into a canonical, order-independent form. */
async function snapshotProjections(db: Database) {
  const customers = await db.getAllAsync('SELECT * FROM customers ORDER BY id', []);
  const balances = await db.getAllAsync('SELECT * FROM balances ORDER BY customer_id', []);
  return { customers, balances };
}

/**
 * Applies commands via append(), translating the synthetic
 * `__voids_entry_id` marker into the real event id append() returned for
 * that entry (append() only knows envelope ids after the fact).
 */
async function applyCommands(store: EventStore, commands: readonly Command[]): Promise<void> {
  const entryIdToEventId = new Map<string, string>();

  for (const command of commands) {
    if (command.type === 'ENTRY_VOIDED') {
      const target = entryIdToEventId.get(command.payload.__voids_entry_id as string);
      if (target === undefined) continue; // target's own append() failed validation — skip
      await store.append('ENTRY_VOIDED', {
        schema_version: 1,
        voids_event_id: target,
        reason: command.payload.reason,
      });
      continue;
    }

    const result = await store.append(command.type as EventType, command.payload);
    if (!('kind' in result) && 'entry_id' in command.payload) {
      entryIdToEventId.set(command.payload.entry_id as string, result.id);
    }
  }
}

const RUNS = 30;
const STEPS_PER_RUN = 20;

void test('REBUILD INVARIANT: rebuildProjections() reproduces append()-built projections exactly (property)', async () => {
  for (let seed = 0; seed < RUNS; seed++) {
    const { store, db } = await createTestStore(`device-${seed}`, seed);
    const commands = generateCommands(seed, STEPS_PER_RUN);

    await applyCommands(store, commands);
    const beforeRebuild = await snapshotProjections(db);

    await store.rebuildProjections();
    const afterRebuild = await snapshotProjections(db);

    assert.deepStrictEqual(
      afterRebuild,
      beforeRebuild,
      `rebuild invariant violated at seed ${seed}: dropping and rebuilding projections produced different state`,
    );
  }
  // no-console allows warn/error only in apps/mobile (unlike packages/domain) —
  // console.warn stands in for the run-count report fast-check would give.
  console.warn(`  rebuild invariant: ${RUNS} random command sequences, ${STEPS_PER_RUN} commands each`);
});

void test('rebuildProjections() on an empty log produces empty projections', async () => {
  const { store, db } = await createTestStore();
  await store.rebuildProjections();
  const snapshot = await snapshotProjections(db);
  assert.deepStrictEqual(snapshot, { customers: [], balances: [] });
});
