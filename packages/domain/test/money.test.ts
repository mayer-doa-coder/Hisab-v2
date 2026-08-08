// money.test.ts — AGENTS.md §3.2. Money is an integer count of poisha;
// arithmetic and rounding live here and only here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, fromTaka, isNegative, subtract, toDisplayTaka } from '../src/money.ts';

void test('fromTaka rounds half toward positive infinity', () => {
  // 10.015 * 100 === 1001.5 exactly in IEEE 754 double — a genuine tie.
  // Math.round ties toward +Infinity, so this rounds UP to 1002.
  assert.equal(fromTaka(10.015), 1002);

  // 10.005 * 100 === 1000.5000000000001 (float representation error, not a
  // real tie) — still resolves to 1001 and does so the same way every time.
  assert.equal(fromTaka(10.005), 1001);
  assert.equal(fromTaka(10.005), fromTaka(10.005));
});

void test('fromTaka: whole number, negative, and zero', () => {
  assert.equal(fromTaka(50), 5000);
  assert.equal(fromTaka(0), 0);

  // Math.round's tie-break is NOT symmetric: -10.015 * 100 === -1001.5 (a
  // genuine tie) rounds to -1001 (toward +Infinity, i.e. toward zero), not
  // -1002. This is documented in money.ts and asserted here so a future
  // switch away from Math.round is a deliberate choice, not an accident.
  assert.equal(fromTaka(-10.015), -1001);
  assert.equal(fromTaka(-25), -2500);
});

void test('add and subtract are correct and associative across several cases', () => {
  const a = fromTaka(10);   // 1000
  const b = fromTaka(5);    // 500
  const c = fromTaka(2.5);  // 250

  assert.equal(add(a, b), 1500);
  assert.equal(add(b, a), add(a, b)); // commutative
  assert.equal(add(add(a, b), c), add(a, add(b, c))); // associative

  assert.equal(subtract(a, b), 500);
  assert.equal(subtract(b, a), -500);
  assert.equal(subtract(a, a), 0);

  // subtract then add back reproduces the original value
  assert.equal(add(subtract(a, b), b), a);
});

void test('subtract producing a negative Poisha does not throw', () => {
  const small = fromTaka(5);
  const large = fromTaka(20);

  assert.doesNotThrow(() => subtract(small, large));
  const result = subtract(small, large);
  assert.equal(result, -1500);
  assert.equal(isNegative(result), true);
  assert.equal(isNegative(fromTaka(0)), false);
  assert.equal(isNegative(fromTaka(1)), false);
});

void test('toDisplayTaka: two decimal places, never scientific notation', () => {
  assert.equal(toDisplayTaka(fromTaka(0)), '0.00');
  assert.equal(toDisplayTaka(fromTaka(50)), '50.00');
  assert.equal(toDisplayTaka(fromTaka(-25)), '-25.00');

  // 12,345,678 poisha = 123,456.78 taka — large enough to matter, nowhere
  // near JS's ~1e21 threshold for switching Number#toFixed to exponential.
  const large = fromTaka(123456.78);
  assert.equal(large, 12345678);
  const display = toDisplayTaka(large);
  assert.equal(display, '123456.78');
  assert.doesNotMatch(display, /e/i);
});
