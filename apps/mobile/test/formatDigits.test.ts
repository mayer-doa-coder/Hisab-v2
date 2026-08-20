// formatDigits.test.ts — formatComposingPoisha(). Found during a
// whole-project audit: this function (then still embedded in
// RecordEntryScreen.tsx, untestable — .tsx stays out of the test compile,
// see test/tsconfig.json) mishandled a negative poisha value: `-5` rendered
// as `"0.-5"`, `-99` as `"-.99"`, on the single largest element on the
// keypad screen. Moved into formatDigits.ts specifically so this class of
// bug has a test from now on.
//
// groupIndian/toNumeralScript/formatAmountDigits pre-date this file's first
// test and have no direct tests of their own yet — a pre-existing gap, not
// fixed here; this file covers only the function this audit added/fixed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatComposingPoisha } from '../src/ui/formatDigits.ts';

void test('formatComposingPoisha: the last two digits are the poisha fraction', () => {
  assert.equal(formatComposingPoisha(0, 'arabic'), '0.00');
  assert.equal(formatComposingPoisha(5, 'arabic'), '0.05');
  assert.equal(formatComposingPoisha(50, 'arabic'), '0.50');
  assert.equal(formatComposingPoisha(500, 'arabic'), '5.00');
  assert.equal(formatComposingPoisha(150_000, 'arabic'), '1,500.00');
});

void test('REGRESSION: a negative poisha value places the sign correctly, not mid-number', () => {
  assert.equal(formatComposingPoisha(-5, 'arabic'), '-0.05');
  assert.equal(formatComposingPoisha(-99, 'arabic'), '-0.99');
  assert.equal(formatComposingPoisha(-30_000, 'arabic'), '-300.00');
});

void test('formatComposingPoisha: Indian grouping applies to the whole part', () => {
  assert.equal(formatComposingPoisha(123_456_700, 'arabic'), '12,34,567.00');
});

void test('formatComposingPoisha: renders Bengali numerals when the script says so', () => {
  assert.equal(formatComposingPoisha(150_000, 'bengali'), '১,৫০০.০০');
  assert.equal(formatComposingPoisha(-5, 'bengali'), '-০.০৫');
});
