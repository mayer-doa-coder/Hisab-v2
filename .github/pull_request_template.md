## What and why

<!-- One or two sentences. Link the issue if there is one. -->

## Ownership

- [ ] This PR touches **only my directories** (see `.github/CODEOWNERS`)
- [ ] If it touches a SHARED file (`packages/domain/src/types.ts`, `index.ts`, `viewmodels/`, `DECISIONS.md`), the other person has agreed

<!-- A PR requesting review from BOTH owners is usually two PRs. -->

## Verification — paste the actual output, don't assert

```
npm run typecheck →
npm test          →
npm run lint      →
npm run size:check →   (if apps/mobile changed)
```

- [ ] `npm test -w packages/domain` still runs in under 5 seconds
- [ ] Projection rebuild test still passes (if `data/` or `domain/` changed)

## Rules check

- [ ] No stored balance, total, or cached quantity — everything derived is a fold
- [ ] No money arithmetic outside `money.ts`; no floats touching money
- [ ] No new import of react/expo/sqlite/fetch inside `packages/domain/`
- [ ] No new dependency — or if there is one, the three questions in `CONTRIBUTING.md` §6 are answered below
- [ ] No new `EXPO_PUBLIC_*` variable
- [ ] No PII in any new log, telemetry, or crash-report path
- [ ] `bn` and `en` strings both added
- [ ] New event type completed the six-item checklist in `docs/EVENTS.md` §9

## New dependency (delete if none)

- What it does that we can't do in <100 lines:
- Measured APK cost (`apkanalyzer`, not a guess):
- What breaks without it:

## Decision record

- [ ] Non-obvious choices appended to `docs/DECISIONS.md`
- [ ] N/A — nothing non-obvious here

## Violations found but not fixed

<!-- If you spotted existing code violating AGENTS.md, list it here rather than
     fixing it in this PR. Mixing an unrelated fix into a diff buries it. -->
