// tokenStore.ts — where auth tokens live on the device.
//
// docs/SECURITY.md §2 and AGENTS.md §8: "Never store anything sensitive in
// AsyncStorage — it is unencrypted. Tokens and keys go in expo-secure-store
// (Android Keystore)." eslint.config.js blocks the AsyncStorage import
// outright, so this is the only available answer and the right one.
//
// NOT in this step (Step 11): SQLCipher, PIN-derived database keys, keystore
// salt management. This file stores tokens, nothing else.

import * as SecureStore from 'expo-secure-store';
import type { AuthTokens } from '../sync/api';
import type { TokenStore } from '../sync/syncEngine';

const KEY = 'hisab.auth.tokens';

export function createSecureTokenStore(): TokenStore {
  return {
    async get(): Promise<AuthTokens | null> {
      const raw = await SecureStore.getItemAsync(KEY);
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as AuthTokens;
      } catch {
        // Corrupted entry — treat as logged out rather than crashing the app
        // at launch. The user re-enters their PIN; nothing in the ledger is
        // affected, since events are stored separately and never expire.
        await SecureStore.deleteItemAsync(KEY);
        return null;
      }
    },

    async set(tokens: AuthTokens): Promise<void> {
      await SecureStore.setItemAsync(KEY, JSON.stringify(tokens));
    },

    async clear(): Promise<void> {
      await SecureStore.deleteItemAsync(KEY);
    },
  };
}
