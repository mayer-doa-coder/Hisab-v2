// screenSecure.ts — SECURITY.md §2: "FLAG_SECURE on screens showing
// balances, the customer list, and customer detail. Blocks screenshots and
// screen recording, and blanks the app in the recents switcher."
//
// NEW DEPENDENCY: expo-screen-capture (~57.0.1), added this step. On
// Android it sets FLAG_SECURE directly; on iOS it overlays the screen in the
// app switcher (there is no FLAG_SECURE equivalent, but the same module
// covers both platforms with one call, which is why it was chosen over a
// hand-rolled Android-only native module). AGENTS.md §3.4 cost disclosure:
// the npm package is 204 KB raw (verified: `du -sh node_modules/expo-screen-capture`).
// That is NOT the compiled APK delta — R8/ProGuard shrinking is already
// enabled (app.json's expo-build-properties) and this is a thin two-function
// wrapper (preventScreenCaptureAsync/allowScreenCaptureAsync) in the same
// class as expo-secure-store, whose measured APK delta was small relative to
// its raw size (DECISIONS.md 2026-08-09's font measurement showed roughly
// half of raw size survives ZIP compression, for comparison). No real build
// exists to measure against — apps/mobile has no screen that imports this
// yet, same reasoning DECISIONS.md 2026-08-09's zod entry used. **[VERIFY]**
// against a real size:check diff once a screen actually mounts this hook.
//
// NOTHING CALLS THIS YET. apps/mobile/src/screens/ is empty (Step 8 has not
// run) — there is no balance screen, customer list, or customer detail to
// apply it to. This is the primitive; wiring it into a real screen is Step
// 8's job. See this step's report for why VERIFY 4 (confirm it blocks a
// screenshot) could not be completed: there is nothing to screenshot.

import { useEffect } from 'react';
import * as ScreenCapture from 'expo-screen-capture';

/**
 * Call from any screen showing balances or customer data. Enables
 * FLAG_SECURE (Android) / the capture-blocking overlay (iOS) for as long as
 * the screen is mounted, and restores the previous state on unmount — so
 * one screen's protection never leaks onto an unrelated screen behind it.
 */
export function useScreenSecure(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;

    void ScreenCapture.preventScreenCaptureAsync();
    return () => {
      void ScreenCapture.allowScreenCaptureAsync();
    };
  }, [enabled]);
}
