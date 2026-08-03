# GitHub Copilot instructions — Hisab v2

**The canonical instruction file for this repository is [`AGENTS.md`](../AGENTS.md). Read it.** This file is a short pointer plus the rules most likely to be violated by inline completion, where there is no room to read a long document.

## Never suggest

- Storing a balance, total, or stock quantity as a field. Balances are folds over the event log. This was the central bug in v1.
- `UPDATE` or `DELETE` against the `events` table. It is append-only; a correction is an `ENTRY_VOIDED` event.
- Floating-point arithmetic on money. Money is an integer count of poisha; arithmetic lives only in `packages/domain/src/money.ts`.
- Any import of `react`, `react-native`, `expo*`, a database, or `fetch` inside `packages/domain/`. That package is pure.
- A new `EXPO_PUBLIC_*` variable. Only `EXPO_PUBLIC_API_BASE_URL` is permitted; anything else is inlined into the shipped bundle.
- Patching a React Native prototype (`Text.render`, `TextInput.render`, `Alert.alert`).
- A loading spinner around a local write, or a confirmation dialog on a high-frequency action. Use undo instead.
- `localStorage`, `sessionStorage`, or `AsyncStorage` for anything sensitive. Secrets go in `expo-secure-store`.
- A barrel `index.ts` for screens or components.
- Hardcoded Bengali numerals for money. Numeral script is a user setting.
- MAPE as a forecasting metric. Use MASE and RMSSE.
- A new npm dependency without asking first — the APK budget is 25 MB and enforced in CI.

## Always

- TypeScript strict. Branded types for units (`Poisha`, `Quantity`, `Days`).
- Domain functions return `Result | DomainError` rather than throwing.
- Both `bn` and `en` translation keys in the same change.
- `snake_case` for database columns, `camelCase` for TypeScript, `SCREAMING_SNAKE_CASE` for event type constants.
- Money field names end in `_poisha`. Quantity field names end in `_units`.

## Never invent

Do not generate citations, statistics, benchmark numbers, or "typical" figures. This repository backs a research paper. Anything unverified is marked `[VERIFY]`. See `AGENTS.md` §9.
