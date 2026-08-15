# Maestro flows

`maestro` is a standalone CLI, not an npm package — install separately:
<https://docs.maestro.dev/getting-started/installing-maestro>. Needs Java
17-21 (not 22+ — see `docs/DECISIONS.md` 2026-08-15 on why) and a running
Android emulator or connected device (`adb devices` must show one).

- `gallery-smoke.yaml` — runs today, against the one real screen that
  exists (`Gallery`). Proves the Maestro + adb + kill/relaunch mechanism
  itself works. Run with `npm run maestro:smoke` (from `apps/mobile/`).
- `kill-app/` — the six-core-screen kill-app matrix, prepared ahead of
  Step 8. **Not runnable yet** — see `kill-app/README.md`.

`docs/TESTING_LOG.md` has the same matrix as a manual checklist, usable
regardless of whether these flows can run yet.
