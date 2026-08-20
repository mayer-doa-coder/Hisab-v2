// customerCommands.test.ts — addCustomer, recordEntry, voidEntry.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Poisha } from '@hisab/domain';
import { createCustomerCommands } from '../src/data/customerCommands.ts';
import { createTestStore, seededRandomBytes } from './testEventStore.ts';

void test('addCustomer creates a customer with a generated id', async () => {
  const { db, store } = await createTestStore();
  const commands = createCustomerCommands(store, { getRandomBytes: seededRandomBytes(1) });

  const result = await commands.addCustomer('রহিম ভাই', null);
  assert.equal(result.kind, 'OK');
  if (result.kind !== 'OK') return;

  const rows = await db.getAllAsync<{ display_name: string }>('SELECT display_name FROM customers WHERE id = ?', [
    result.customerId,
  ]);
  assert.equal(rows[0]?.display_name, 'রহিম ভাই');
});

void test('recordEntry: CREDIT then PAYMENT nets to the correct projected balance', async () => {
  const { db, store } = await createTestStore();
  const commands = createCustomerCommands(store, { getRandomBytes: seededRandomBytes(2) });

  const added = await commands.addCustomer('করিম', null);
  assert.equal(added.kind, 'OK');
  if (added.kind !== 'OK') return;

  const credit = await commands.recordEntry('CREDIT', added.customerId, 50_000 as Poisha);
  assert.equal(credit.kind, 'OK');

  const payment = await commands.recordEntry('PAYMENT', added.customerId, 20_000 as Poisha);
  assert.equal(payment.kind, 'OK');

  const rows = await db.getAllAsync<{ balance_poisha: number }>(
    'SELECT balance_poisha FROM balances WHERE customer_id = ?',
    [added.customerId],
  );
  assert.equal(rows[0]?.balance_poisha, 30_000);
});

void test('voidEntry undoes a recorded entry’s effect on the projected balance', async () => {
  const { db, store } = await createTestStore();
  const commands = createCustomerCommands(store, { getRandomBytes: seededRandomBytes(3) });

  const added = await commands.addCustomer('সালমা', null);
  assert.equal(added.kind, 'OK');
  if (added.kind !== 'OK') return;

  const credit = await commands.recordEntry('CREDIT', added.customerId, 75_000 as Poisha);
  assert.equal(credit.kind, 'OK');
  if (credit.kind !== 'OK') return;

  const voided = await commands.voidEntry(credit.eventId, 'MISTAKE');
  assert.equal(voided.kind, 'OK');

  const rows = await db.getAllAsync<{ balance_poisha: number }>(
    'SELECT balance_poisha FROM balances WHERE customer_id = ?',
    [added.customerId],
  );
  // The customer's only entry was voided — no balance row at all, same as
  // eventStore.ts's writeProjection() deleting a row with nothing left to fold.
  assert.equal(rows.length, 0);
});
