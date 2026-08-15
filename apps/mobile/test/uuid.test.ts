// uuid.test.ts — UUIDv7's bit-layout math was hand-verified against 1000
// real timestamps in a throwaway script during Step 9 and then discarded.
// This is that verification turned into a permanent test, plus the
// version/variant/roundtrip checks RFC 9562 actually requires.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uuidv7 } from '../src/data/uuid.ts';

function fixedRandomBytes(fill: number): (n: number) => Uint8Array {
  return (n: number) => new Uint8Array(n).fill(fill);
}

void test('the embedded 48-bit timestamp round-trips exactly across many real values', () => {
  const base = Date.now();
  for (let i = 0; i < 1000; i++) {
    const t = base + i * 137; // a spread, not just consecutive ms
    const id = uuidv7(t, fixedRandomBytes(0xab));
    const hex = id.replace(/-/g, '').slice(0, 12);
    const reconstructed = parseInt(hex, 16);
    assert.equal(reconstructed, t, `timestamp did not round-trip for t=${t}`);
  }
});

void test('version nibble is 7 and variant bits are 10 (RFC 9562)', () => {
  const id = uuidv7(Date.now(), fixedRandomBytes(0xff));
  const hex = id.replace(/-/g, '');
  assert.equal(hex[12], '7', 'version nibble must be 7');
  const variantByte = parseInt(hex.slice(16, 18), 16);
  assert.equal(variantByte >> 6, 0b10, 'top two bits of the variant byte must be 10');
});

void test('produces a well-formed UUID string (8-4-4-4-12 hex groups)', () => {
  const id = uuidv7(Date.now(), fixedRandomBytes(0x00));
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

void test('different random bytes produce different ids for the same timestamp', () => {
  const t = Date.now();
  const a = uuidv7(t, fixedRandomBytes(0x11));
  const b = uuidv7(t, fixedRandomBytes(0x22));
  assert.notEqual(a, b);
});

void test('throws rather than silently truncating if fewer than 10 random bytes are provided', () => {
  assert.throws(() => uuidv7(Date.now(), () => new Uint8Array(3)));
});
