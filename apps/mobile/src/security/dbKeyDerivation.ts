// dbKeyDerivation.ts — SECURITY.md §2: "SQLite encrypted with SQLCipher. The
// key is derived from the user's PIN with Argon2id (or PBKDF2 with a high
// iteration count if Argon2 is impractical in the RN setup). The salt lives
// in Android Keystore. The key is never written to disk in plaintext."
// "Changing the PIN re-keys the database. Test this path; it is easy to get
// wrong and silently lose data."
//
// THIS FILE IS THE ORCHESTRATION LOGIC ONLY — key derivation, salt handling,
// and the re-key SEQUENCE — written as pure, dependency-injected functions
// exactly like clock.ts and uuid.ts already are, so they are fully testable
// without a device. IT IS NOT WIRED TO A REAL SQLCIPHER-CAPABLE SQLITE
// ENGINE. apps/mobile/src/data/db.ts's `Database` interface (expo-sqlite)
// has no encryption concept at all — no open-with-key, no PRAGMA rekey.
// Encrypting the real database means REPLACING the SQLite engine entirely,
// which is a bigger change than this step's environment allows to attempt
// safely (see this step's report on why: no confirmed low-risk path to a
// real device build in the time available, and this project has hit three
// separate real native-build failures already — DECISIONS.md 2026-08-10,
// 2026-08-15 x2). The `EncryptableDatabase` interface below is the seam a
// real backend will implement; `db.expo.ts` does not implement it yet.
//
// LIBRARY CHOICE, investigated this step, not yet added as a dependency:
//
//   Argon2id: `react-native-argon2` (npm, verified this step) — v4.0.0,
//   published 9 months before this step, ~5,864 weekly downloads, zero
//   transitive dependencies, 30.3 KB unpacked. Real and maintained, clears
//   this project's own bar (clock.ts rejected an HLC package specifically
//   for "under 100 weekly downloads, one five years unmaintained" — this
//   clears both). Its exact current API surface (which Argon2 variant flags
//   it exposes, whether "id" specifically is selectable) has NOT been
//   verified against its live docs — [VERIFY] before wiring it for real.
//
//   SQLCipher-capable SQLite engine: `@op-engineering/op-sqlite` (npm,
//   verified this step) — v18.0.0, published the day before this step,
//   ~129,861 weekly downloads, clearly the most active option; historically
//   (per its own documented feature set, not independently re-verified this
//   step) supports SQLCipher via a build-time config flag. THE REAL COST
//   RISK: SQLCipher bundles a crypto library (commonly OpenSSL) into the
//   compiled binary. This project has 2.73 MB of APK headroom left
//   (DECISIONS.md 2026-08-15). I am not asserting a specific MB figure for
//   the SQLCipher delta — AGENTS.md §9 forbids inventing numbers, and I have
//   not run a real build to measure it — but community discussion of
//   SQLCipher's Android footprint commonly cites a multi-MB crypto-library
//   cost, which could plausibly consume all remaining headroom or exceed
//   it. THIS NEEDS A REAL MEASURED BUILD BEFORE ANY COMMITMENT, and is the
//   single biggest open risk in this step.
//
// Argon2id over PBKDF2 (SECURITY.md §2's stated preference, not the
// fallback) because a real, maintained RN Argon2 option exists — the
// PBKDF2 escape hatch in §2's own wording is for when Argon2 turns out to
// be impractical, which this investigation did not find to be the case.

export type Argon2idFn = (
  pin: string,
  salt: Uint8Array,
  options: { readonly iterations: number; readonly memoryKiB: number; readonly hashLengthBytes: number },
) => Promise<Uint8Array>;

/**
 * Cost parameters are a placeholder, not a tuned value — same status as
 * anomalies.ts's DUPLICATE_SUSPECTED_WINDOW_MS: no real 2 GB-device timing
 * data exists yet for how expensive a derivation the credit-entry flow's
 * cold-start budget (UI_SPEC.md: "< 3 seconds... on a 2 GB device") can
 * absorb on the PIN-unlock path. 64 MiB / 3 iterations is a commonly cited
 * OWASP-adjacent floor for Argon2id, not a number this project has measured
 * on its own target hardware.
 */
export const ARGON2ID_MEMORY_KIB = 64 * 1024;
export const ARGON2ID_ITERATIONS = 3;
export const DB_KEY_LENGTH_BYTES = 32;

const SALT_KEY = 'hisab.db_key_salt';

export interface SecureStoreLike {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
}

/**
 * Salt lives in Keystore-backed secure storage (SECURITY.md §2), generated
 * once and reused for every derivation — reads-or-creates, same discipline
 * as deviceId.ts, for the same reason: regenerating it would silently
 * change the key derived from the SAME PIN, making a previously-encrypted
 * database unreadable without anyone typing a wrong PIN.
 */
export async function getOrCreateSalt(
  store: SecureStoreLike,
  generateSaltBytes: () => Uint8Array,
): Promise<Uint8Array> {
  const existing = await store.getItemAsync(SALT_KEY);
  if (existing !== null) {
    return hexToBytes(existing);
  }
  const salt = generateSaltBytes();
  await store.setItemAsync(SALT_KEY, bytesToHex(salt));
  return salt;
}

/** The database encryption key, derived fresh from the PIN every unlock — never itself persisted (SECURITY.md §2: "never written to disk in plaintext"). */
export async function deriveDbKey(pin: string, salt: Uint8Array, argon2id: Argon2idFn): Promise<Uint8Array> {
  return argon2id(pin, salt, {
    iterations: ARGON2ID_ITERATIONS,
    memoryKiB: ARGON2ID_MEMORY_KIB,
    hashLengthBytes: DB_KEY_LENGTH_BYTES,
  });
}

/**
 * The seam a real SQLCipher-capable backend implements. `open` with the
 * wrong key must fail (or, if the underlying engine only signals this on
 * first real read, `verify` does one cheap read to confirm) — never silently
 * succeed with an unusable connection.
 */
export interface EncryptableDatabase {
  open(key: Uint8Array): Promise<boolean>;
  /** SQLCipher's own PRAGMA rekey — re-encrypts in place, does not create a new file. */
  rekey(newKey: Uint8Array): Promise<void>;
  /** One cheap, real read (e.g. `SELECT 1 FROM events LIMIT 1`) — proof the connection actually works, not just that open() didn't throw. */
  verify(): Promise<boolean>;
  close(): Promise<void>;
}

export type RekeyResult =
  | { readonly kind: 'OK' }
  | { readonly kind: 'WRONG_CURRENT_PIN' }
  | { readonly kind: 'REKEY_FAILED'; readonly error: unknown };

/**
 * THE RE-KEY SEQUENCE. SECURITY.md §2: "Changing the PIN re-keys the
 * database. Test this path; it is easy to get wrong and silently lose
 * data." The easy way to get it wrong: rekey in place with no verification
 * step, and a rekey that silently failed midway leaves a database no known
 * key opens. This sequence:
 *
 *   1. Opens with the CURRENT key first — proves the current PIN is right
 *      before touching anything. Never trust the caller's claim that the
 *      old PIN was correct.
 *   2. Derives the NEW key from the new PIN, using the SAME salt — the salt
 *      does not rotate on a PIN change; only the PIN input changes.
 *   3. Calls rekey(), then immediately verify()s with a real read — proof
 *      the database is actually usable under the new key, not just that
 *      rekey() didn't throw.
 *   4. On any failure at step 3, this function does NOT attempt to "roll
 *      back" — SQLCipher's rekey is not transactional across a crash, and a
 *      partial rekey's actual state depends on exactly where it failed.
 *      Returning REKEY_FAILED with the raw error is honest; pretending a
 *      rollback succeeded would be the "silently lose data" failure mode
 *      §2 warns about, dressed up as success.
 */
export async function changePin(
  db: EncryptableDatabase,
  salt: Uint8Array,
  currentPin: string,
  newPin: string,
  argon2id: Argon2idFn,
): Promise<RekeyResult> {
  const currentKey = await deriveDbKey(currentPin, salt, argon2id);
  const opened = await db.open(currentKey);
  if (!opened) {
    return { kind: 'WRONG_CURRENT_PIN' };
  }

  const newKey = await deriveDbKey(newPin, salt, argon2id);
  try {
    await db.rekey(newKey);
    const readable = await db.verify();
    if (!readable) {
      return { kind: 'REKEY_FAILED', error: new Error('rekey() completed but verify() could not read the database') };
    }
    return { kind: 'OK' };
  } catch (error) {
    return { kind: 'REKEY_FAILED', error };
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
