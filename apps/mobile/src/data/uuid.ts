// uuid.ts — UUIDv7 (RFC 9562), hand-rolled. docs/EVENTS.md §1 specifies
// UUIDv7 for event ids explicitly ("UUIDv7, generated on-device"); neither
// this RN/Expo setup's global `crypto` nor `expo-crypto`'s own
// `Crypto.randomUUID()` produces v7 — both are v4 (RFC4122). The 48-bit
// timestamp + version/variant bit-layout is small and precisely specified,
// so it's hand-rolled the same way clock.ts's HLC is; the RANDOM BITS are
// not hand-rolled — `getRandomBytes` is injected so real callers pass
// expo-crypto's `Crypto.getRandomBytes` (cryptographically secure) and
// tests pass a seeded fake, never `Math.random()`.

export type GetRandomBytes = (byteCount: number) => Uint8Array;

const HEX = '0123456789abcdef';

function hexDigit(nibble: number): string {
  const digit = HEX[nibble];
  if (digit === undefined) throw new Error('uuidv7: unreachable — nibble is always 0-15');
  return digit;
}

function toHex(bytes: Uint8Array, start: number, end: number): string {
  let out = '';
  for (let i = start; i < end; i++) {
    const byte = bytes[i];
    if (byte === undefined) throw new Error('uuidv7: unreachable — index within bounds');
    out += hexDigit((byte >> 4) & 0xf) + hexDigit(byte & 0xf);
  }
  return out;
}

/**
 * UUIDv7 layout (RFC 9562 §5.7):
 *   48 bits  unix_ts_ms
 *    4 bits  version (0111)
 *   12 bits  rand_a
 *    2 bits  variant (10)
 *   62 bits  rand_b
 */
export function uuidv7(now: number, getRandomBytes: GetRandomBytes): string {
  const bytes = new Uint8Array(16);

  // 48-bit big-endian timestamp into bytes[0..5]
  const ts = Math.floor(now);
  bytes[0] = (ts / 2 ** 40) & 0xff;
  bytes[1] = (ts / 2 ** 32) & 0xff;
  bytes[2] = (ts >>> 24) & 0xff;
  bytes[3] = (ts >>> 16) & 0xff;
  bytes[4] = (ts >>> 8) & 0xff;
  bytes[5] = ts & 0xff;

  const random = getRandomBytes(10); // 12 bits rand_a + 62 bits rand_b = 74 bits, fits in 10 bytes
  const r0 = random[0];
  const r1 = random[1];
  if (r0 === undefined || r1 === undefined) {
    throw new Error('uuidv7: getRandomBytes returned fewer than 10 bytes');
  }

  // bytes[6..7]: version (0111) + top 12 bits of rand_a
  bytes[6] = 0x70 | (r0 & 0x0f);
  bytes[7] = r1;

  // bytes[8..15]: variant (10) + 62 bits of rand_b
  const r2 = random[2];
  if (r2 === undefined) throw new Error('uuidv7: getRandomBytes returned fewer than 10 bytes');
  bytes[8] = 0x80 | (r2 & 0x3f);
  for (let i = 9; i < 16; i++) {
    const r = random[i - 6];
    if (r === undefined) throw new Error('uuidv7: getRandomBytes returned fewer than 10 bytes');
    bytes[i] = r;
  }

  return [
    toHex(bytes, 0, 4),
    toHex(bytes, 4, 6),
    toHex(bytes, 6, 8),
    toHex(bytes, 8, 10),
    toHex(bytes, 10, 16),
  ].join('-');
}
