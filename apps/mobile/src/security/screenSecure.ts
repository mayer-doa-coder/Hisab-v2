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
// has measured the delta against a build that actually mounts this hook —
// AgingScreen.tsx does now, but the 22.44 MB build in DECISIONS.md 2026-08-20
// predates this file being wired in. **[VERIFY]** against a real size:check
// diff on the next build.
//
// WIRED as of Step 13: `apps/mobile/src/screens/AgingScreen.tsx` — "the
// customer list" with every customer's balance on it — calls
// `useScreenSecure()` unconditionally. Found unwired during a whole-project
// audit after that screen existed; the gap between "the primitive exists"
// and "a real screen calls it" is exactly the kind of thing that slips
// through when a primitive is built ahead of the screen that needs it.
// VERIFY 4 (confirm it actually blocks a screenshot) still has not been run
// against a real device — see this step's report.

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
