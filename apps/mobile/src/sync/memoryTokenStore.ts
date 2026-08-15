// memoryTokenStore.ts — a TokenStore that keeps tokens in the heap.
//
// Separate from security/tokenStore.ts on purpose: that file imports
// expo-secure-store, which is a native module and cannot load in a plain Node
// test process. This one has no imports at all, so the convergence harness in
// server/test/ can drive a real SyncEngine without pulling Expo into a
// server-side compile.
//
// NEVER used in the app. Real device storage is expo-secure-store, backed by
// Android Keystore (docs/SECURITY.md §2) — AsyncStorage is unencrypted and is
// blocked outright by eslint.config.js.

import type { AuthTokens } from './api';
import type { TokenStore } from './syncEngine';

export function createMemoryTokenStore(initial: AuthTokens | null = null): TokenStore {
  let tokens: AuthTokens | null = initial;
  return {
    get: () => Promise.resolve(tokens),
    set: (next) => {
      tokens = next;
      return Promise.resolve();
    },
    clear: () => {
      tokens = null;
      return Promise.resolve();
    },
  };
}
