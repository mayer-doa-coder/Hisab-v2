// deviceId.ts — generated once, persisted, stable across restarts.
// docs/SECURITY.md §2 names this explicitly: "Tokens, keys, and the device
// id go in expo-secure-store, backed by Android Keystore." Not a judgment
// call in this step — that line was already written down before this step
// started; this file just implements it.
//
// The two-method shape below matches expo-secure-store's actual API
// directly (getItemAsync/setItemAsync), so the real module can be passed in
// as-is with no wrapper, and tests pass a plain in-memory object satisfying
// the same shape — no mocking framework needed.

export interface KeyValueStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
}

const DEVICE_ID_KEY = 'hisab.device_id';

/**
 * Reads-or-creates a stable id under `key`, never blindly creates. Generic
 * over `getOrCreateDeviceId`'s own shape because `bootstrap.ts` (Step 14)
 * needs the identical read-or-create-once behaviour for `shop_id` — there is
 * no login screen yet (BUILD_PLAN.md Phase 2: "Still no network"), so a
 * shop, like a device, gets a stable local id generated once and persisted,
 * not asked for.
 */
export async function getOrCreateId(
  store: KeyValueStore,
  key: string,
  generateId: () => string,
): Promise<string> {
  const existing = await store.getItemAsync(key);
  if (existing !== null) {
    return existing;
  }
  const id = generateId();
  await store.setItemAsync(key, id);
  return id;
}

/**
 * Regenerating device_id per session breaks HLC ordering (a new "device")
 * and seq monotonicity (UNIQUE(device_id, seq) would restart at 1 for what
 * SQLite would treat as a different device) — so this reads-or-creates,
 * never blindly creates.
 */
export async function getOrCreateDeviceId(
  store: KeyValueStore,
  generateId: () => string,
): Promise<string> {
  return getOrCreateId(store, DEVICE_ID_KEY, generateId);
}
