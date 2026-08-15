// passwords.ts — PIN hashing. docs/SECURITY.md §4: "PIN hashed server-side...
// Never stored in plaintext or reversibly on the device."
//
// scrypt, from node:crypto. §4's literal wording says "bcrypt or Argon2";
// scrypt is a memory-hard KDF in the same family and needs no dependency,
// which matters here because every native-compiling package is a real install
// risk in this environment (already reproduced with better-sqlite3 —
// DECISIONS.md 2026-08-10). This is a deliberate, flagged deviation from §4's
// wording, recorded in DECISIONS.md 2026-08-15 — not a silent substitution.
//
// NOT in this step (Step 11): exponential lockout on repeated failures. The
// client has a local attempt counter; the server does not yet rate-limit.

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// N=2^15 keeps a single hash in the low hundreds of milliseconds on a modest
// server. maxmem must be raised explicitly: node's default 32 MB cap is below
// the ~128*N*r bytes (~64 MB) this configuration needs.
const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 32;
const MAXMEM = 128 * N * R * 2;

const PREFIX = 'scrypt';

/** `scrypt$N$r$p$<salt-hex>$<hash-hex>`. Self-describing, so N can be raised later without breaking old hashes. */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(pin, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return [PREFIX, N, R, P, salt.toString('hex'), derived.toString('hex')].join('$');
}

/**
 * Reads the cost parameters back out of the stored hash rather than assuming
 * the current constants, so raising N later does not invalidate existing rows.
 * Comparison is `timingSafeEqual`, never `===`.
 */
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6) return false;

  const [prefix, nStr, rStr, pStr, saltHex, hashHex] = parts;
  if (prefix !== PREFIX || nStr === undefined || rStr === undefined || pStr === undefined) return false;
  if (saltHex === undefined || hashHex === undefined) return false;

  const n = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  const expected = Buffer.from(hashHex, 'hex');
  const derived = await scrypt(pin, Buffer.from(saltHex, 'hex'), expected.length, {
    N: n,
    r,
    p,
    maxmem: 128 * n * r * 2,
  });

  // timingSafeEqual throws on a length mismatch, so guard first.
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
