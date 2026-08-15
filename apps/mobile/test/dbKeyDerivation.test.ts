// dbKeyDerivation.test.ts — Step 11 audit item 2. Tests the KEY DERIVATION
// AND RE-KEY SEQUENCE LOGIC ONLY, against a fake EncryptableDatabase double.
//
// WHAT THIS DOES NOT PROVE, stated plainly: it does not prove a real
// SQLCipher-encrypted SQLite file is unreadable with the wrong key, or
// readable with the right one, on a real device. That requires a real
// SQLCipher-capable engine wired into apps/mobile/src/data/db.ts, which does
// not exist yet — see dbKeyDerivation.ts's header. This file proves the
// ORCHESTRATION is correct: the sequence checks the current PIN before
// touching anything, derives with the right salt, verifies after rekeying,
// and never claims success it didn't confirm.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  changePin,
  deriveDbKey,
  getOrCreateSalt,
  type Argon2idFn,
  type EncryptableDatabase,
} from '../src/security/dbKeyDerivation.ts';

/**
 * Deterministic stand-in for a real Argon2id call — same key in, same key
 * out, and different pins/salts must diverge. POSITION-WEIGHTED on purpose:
 * an early version summed character codes with no weighting, which made
 * '123456' and '654321' collide (same digits, same sum) — a real bug caught
 * by "deriveDbKey diverges for a different pin" actually running, not by
 * inspection. Never used for anything but tests.
 */
const fakeArgon2id: Argon2idFn = (pin, salt, options) => {
  const out = new Uint8Array(options.hashLengthBytes);
  let seed = salt.reduce((a, b, i) => a + b * (i + 1), 0);
  for (let i = 0; i < pin.length; i++) {
    seed += pin.charCodeAt(i) * (i + 1) * 31;
  }
  for (let i = 0; i < out.length; i++) {
    out[i] = (seed + i) & 0xff;
  }
  return Promise.resolve(out);
};

function fakeSecureStore(): { getItemAsync: (k: string) => Promise<string | null>; setItemAsync: (k: string, v: string) => Promise<void> } {
  const map = new Map<string, string>();
  return {
    getItemAsync: (k) => Promise.resolve(map.get(k) ?? null),
    setItemAsync: (k, v) => {
      map.set(k, v);
      return Promise.resolve();
    },
  };
}

/** A fake encrypted database: "open" only succeeds if the key matches whatever it was last (re)keyed with. */
function fakeEncryptableDatabase(initialKey: Uint8Array): EncryptableDatabase & { currentKey: Uint8Array } {
  const state = { currentKey: initialKey, isOpen: false };
  return {
    get currentKey() {
      return state.currentKey;
    },
    open(key) {
      state.isOpen = bytesEqual(key, state.currentKey);
      return Promise.resolve(state.isOpen);
    },
    rekey(newKey) {
      if (!state.isOpen) throw new Error('rekey() called without a successful open() first');
      state.currentKey = newKey;
      return Promise.resolve();
    },
    verify() {
      return Promise.resolve(state.isOpen);
    },
    close() {
      state.isOpen = false;
      return Promise.resolve();
    },
  };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// ---------------------------------------------------------------------------
// Salt
// ---------------------------------------------------------------------------

void test('getOrCreateSalt creates once, then always returns the SAME salt', async () => {
  const store = fakeSecureStore();
  let calls = 0;
  const generate = () => {
    calls++;
    return new Uint8Array([1, 2, 3, 4]);
  };

  const first = await getOrCreateSalt(store, generate);
  const second = await getOrCreateSalt(store, generate);

  assert.deepStrictEqual(first, second);
  assert.equal(calls, 1, 'regenerating the salt would silently change every future derivation from the same PIN');
});

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

void test('deriveDbKey is deterministic for the same pin+salt, and diverges for a different pin', async () => {
  const salt = new Uint8Array([9, 9, 9]);
  const keyA1 = await deriveDbKey('123456', salt, fakeArgon2id);
  const keyA2 = await deriveDbKey('123456', salt, fakeArgon2id);
  const keyB = await deriveDbKey('654321', salt, fakeArgon2id);

  assert.deepStrictEqual(keyA1, keyA2, 'same pin + same salt must derive the same key');
  assert.notDeepStrictEqual(keyA1, keyB, 'a different pin must derive a different key');
});

// ---------------------------------------------------------------------------
// changePin — the re-key sequence
// ---------------------------------------------------------------------------

void test('changePin: the happy path — old key still readable before, new key readable after', async () => {
  const salt = new Uint8Array([5, 5, 5]);
  const oldKey = await deriveDbKey('111111', salt, fakeArgon2id);
  const db = fakeEncryptableDatabase(oldKey);

  const result = await changePin(db, salt, '111111', '222222', fakeArgon2id);
  assert.deepStrictEqual(result, { kind: 'OK' });

  const newKey = await deriveDbKey('222222', salt, fakeArgon2id);
  assert.deepStrictEqual(db.currentKey, newKey, 'the database must actually be keyed to the NEW derived key');

  // And the OLD key genuinely no longer opens it — this is the literal
  // VERIFY 2 ask ("readable with the new key and NOT with the old one"),
  // proven against the fake double.
  assert.equal(await db.open(oldKey), false, 'the old key must not open the database after rekeying');
  assert.equal(await db.open(newKey), true, 'the new key must open it');
});

void test('changePin refuses to touch the database if the CURRENT pin is wrong', async () => {
  const salt = new Uint8Array([7, 7, 7]);
  const realKey = await deriveDbKey('111111', salt, fakeArgon2id);
  const db = fakeEncryptableDatabase(realKey);

  const result = await changePin(db, salt, 'WRONG-PIN', '222222', fakeArgon2id);
  assert.deepStrictEqual(result, { kind: 'WRONG_CURRENT_PIN' });

  // Nothing changed — the original key still opens it.
  assert.equal(await db.open(realKey), true);
});

void test('changePin surfaces a failed rekey honestly rather than claiming success', async () => {
  const salt = new Uint8Array([2, 2, 2]);
  const oldKey = await deriveDbKey('111111', salt, fakeArgon2id);
  const db = fakeEncryptableDatabase(oldKey);
  const originalRekey = db.rekey.bind(db);
  db.rekey = () => {
    void originalRekey; // keep the reference for readability; not calling the real one
    return Promise.reject(new Error('simulated native rekey failure'));
  };

  const result = await changePin(db, salt, '111111', '222222', fakeArgon2id);
  assert.equal(result.kind, 'REKEY_FAILED');
  if (result.kind === 'REKEY_FAILED') {
    assert.ok(result.error instanceof Error);
  }
});

void test('changePin uses the SAME salt for the new derivation — salt does not rotate on a PIN change', async () => {
  const salt = new Uint8Array([3, 1, 4, 1, 5]);
  const oldKey = await deriveDbKey('111111', salt, fakeArgon2id);
  const db = fakeEncryptableDatabase(oldKey);

  await changePin(db, salt, '111111', '222222', fakeArgon2id);

  // Deriving with a DIFFERENT salt for the same new pin must NOT match what
  // the database was actually rekeyed to — proving changePin really used
  // the salt it was given, not a fresh one.
  const wrongSaltKey = await deriveDbKey('222222', new Uint8Array([9, 9, 9, 9, 9]), fakeArgon2id);
  assert.notDeepStrictEqual(db.currentKey, wrongSaltKey);
});
