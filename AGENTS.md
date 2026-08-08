# AGENTS.md — Hisab v2

**This file is the canonical set of instructions for any AI coding agent working in this repository** (Claude Code, Cursor, Copilot, Codex, Windsurf, Aider, or anything else). `CLAUDE.md` and `.github/copilot-instructions.md` point here. If you are an agent and you read only one file, read this one.

**Read this fully before your first edit in a session.** Sections 3 and 4 are hard constraints, not preferences. Hisab v2 is a rebuild of a previous version that failed for specific, documented reasons; most of the rules below exist to prevent a specific bug that actually happened.

---

## 1. What this project is

Hisab is an offline-first mobile ledger for small general stores (দোকান) in Bangladesh. The single most important job it does is **recording baki (customer credit) and joma (repayment) faster than a paper notebook.**

The user is a shopkeeper standing behind a counter with a customer waiting. Every design and engineering decision is subordinate to that.

**This is a financial application.** A ledger that is 99% correct is worthless. Correctness beats features, features beat performance, performance beats elegance.

**This is also an undergraduate research project** aiming at a peer-reviewed publication. Claims in code comments, documentation, and the paper must be traceable to evidence. See §9.

### Non-goals for v2

Do not build these, do not scaffold them, do not add dependencies for them, and do not suggest them unprompted:

- Multi-branch, multi-staff, team users, role hierarchies beyond `OWNER` / `HELPER`
- Approval workflows, purchase orders, goods receipt, cycle counts, supplier payables, day-close reconciliation
- Cross-shop customer identity or any sharing of customer data between shops (see §4.7)
- Champion/challenger ML deployment, canary rollout, drift monitoring, model registries
- Zero-knowledge proofs, CRDT frameworks, neuro-symbolic models
- USSD codes, payment webhooks, SMS gateways (Phase 7 at the earliest, and only after regulatory checks)
- On-device Whisper or any general-purpose neural ASR (see §4.5)

---

## 2. Repository layout and ownership

This is a two-person project. Every directory has exactly one owner. **Ownership is enforced in `.github/CODEOWNERS`.**

```
packages/domain/          [A]  pure TypeScript, zero I/O — the heart of the system
  src/types.ts            [SHARED]  the A↔B contract; changing it requires both people
  src/index.ts            [SHARED]  the public API surface
apps/mobile/src/data/     [A]  SQLite event store and projections
apps/mobile/src/sync/     [A]  push/pull, backoff, background task
apps/mobile/src/security/ [A]  key derivation, encrypted DB, keystore
apps/mobile/src/ui/       [B]  design system primitives
apps/mobile/src/screens/  [B]  one file per screen
apps/mobile/src/navigation/ [B]
apps/mobile/src/i18n/     [B]  namespaced, never one big file
apps/mobile/src/search/   [B]  banglish + phonetic matching
apps/mobile/src/viewmodels/ [SHARED]  shapes A produces and B renders
server/                   [A]
research/                 [B]
docs/DECISIONS.md         [SHARED]  append-only
.github/workflows/        [A]
```

**Agent rule:** before editing, check which directory you're in. If the task spans both owners' directories, say so and ask which half to do, rather than silently editing both. A pull request that touches both `packages/domain/` and `apps/mobile/src/screens/` is almost always two pull requests.

---

## 3. The five rules

These are the load-bearing constraints. If a request conflicts with one of them, stop and say so rather than complying.

### 3.1 The domain layer has zero I/O

`packages/domain/` must not import from `react`, `react-native`, `expo`, `expo-*`, any database library, `fetch`, `axios`, or anything touching the filesystem, network, or platform.

It contains pure functions only:

```ts
fold(events: Event[]): LedgerState
applyCredit(state: LedgerState, cmd: CreditCommand): Event[] | DomainError
applyPayment(state: LedgerState, cmd: PaymentCommand): Event[] | DomainError
applyCorrection(state: LedgerState, cmd: CorrectionCommand): Event[] | DomainError
detectAnomalies(state: LedgerState, events: Event[]): Anomaly[]
reorderPoint(history: DailySales[], leadTimeDays: number, serviceLevel: number): number
```

`applyCorrection` was missing from this list; `docs/BUILD_PLAN.md` Phase 1 has always named it. It emits `ENTRY_VOIDED`. `detectAnomalies` takes the event slice as a second argument rather than reading it off `LedgerState`, so the caller decides how much of the log is in memory — see §4.2.

Why: it makes every financial rule testable in milliseconds without a device, a database, or a network; it lets the mobile app and the Node server share one implementation instead of two that drift; and it makes a future port to Kotlin a mechanical translation rather than a rewrite.

This rule is enforced by ESLint (`no-restricted-imports` in `packages/domain/`). Do not add an eslint-disable to work around it. If you think the domain layer needs I/O, the design is wrong — surface the problem instead.

### 3.2 Money is an integer count of poisha

```ts
export type Poisha = number & { readonly __brand: 'Poisha' };
```

- 1 BDT = 100 poisha. Money is always `INTEGER` in SQLite and `bigint`/`integer` in Postgres.
- Every money-bearing field name ends in `_poisha`.
- Arithmetic on money happens **only** inside `packages/domain/src/money.ts`.
- Floating point never touches a monetary value. No `parseFloat`, no `*`, no `/` outside `money.ts`.
- Conversion to a display string happens only at the render boundary, via `toDisplayTaka()`. `toDisplayTaka()` is called by the viewmodel builder, not by a screen — the domain hands B pre-formatted strings (`CONTRIBUTING.md` §2), so it needs the numeral-script setting and Indian grouping passed in. B supplies both through `ViewModelFormatter`.

**The one carve-out: an amount being composed at the keypad is not yet money.** `docs/UI_SPEC.md` screen 4 has quick chips where "tap to add, tap again to add again," and screen 5 prefills the full balance into an editable field. Both require integer addition in a component, and neither is possible if §3.2 is read absolutely. So: while an amount is being entered, B may add and subtract **integer poisha** in component state. B may not divide it, may not use a float, and may not format it — formatting stays with `ViewModelFormatter`. The moment the amount becomes an event it is ledgered money again and this carve-out ends. Without this, the single most important screen in the app cannot be built without breaking a rule, which is worse than naming the exception.

Why: v1 mixed `amountCents` on some models with a bare `amount` on `BakiEntry`, which is a silent 100× error waiting to happen in a system where the two flow into the same balance calculation.

### 3.3 The event log is append-only; balances are derived

The `events` table is written with `INSERT` only. There is no `UPDATE`, no `DELETE`, no soft-delete flag on it.

- A correction is a new `ENTRY_VOIDED` event referencing the original event's id.
- Balances, stock levels, aging buckets, and daily summaries are **folds over events**. They are never stored as mutable fields.
- Projections (`customers`, `balances`, `stock`) are derived caches. They must be droppable and rebuildable from the log at any time, producing byte-identical state. There is a test for this; keep it passing.
- Every event payload carries `schema_version` from the very first event.

Why: v1 stored `Customer.currentDue`, `Customer.totalPaid`, `Supplier.totalOwed`, and both `Product.quantity` and `InventoryBatch.quantity`. Those materialised values drift under offline sync, which is why v1 needed three `validate*Consistency` functions, four conflict token types, and three resolution strategies. Deriving instead of storing removes the entire problem class.

### 3.4 The APK budget is 25 MB per-ABI and it is enforced in CI

`.github/workflows/size-gate.yml` fails the build above the limit.

**Never add a dependency without saying what it costs.** When proposing one, state: what it does, its approximate contribution to APK size, and what breaks if we don't have it. If a dependency would push the build over budget, propose a smaller alternative or say the feature can't be done within budget.

Dependencies that are scaffolded but unused get deleted, not kept "for later."

### 3.5 Never break the person at the counter

The credit-entry flow must complete in **under 8 seconds and 5 taps**, on a 2 GB device, with the app cold. That is the hard performance requirement; everything else negotiates around it.

Practical consequences:
- No spinner or loading state on a local write. The write is already durable.
- No confirmation dialog on high-frequency actions. Use a 10-second undo instead.
- Draft state persists to disk on every field change, not on submit — the app can be backgrounded at any moment.
- No network call in any core flow, ever. Sync happens in the background.

---

## 4. Forbidden patterns

Each of these is something that existed in v1. Do not reintroduce them, and flag them if you find them.

### 4.1 Never monkey-patch React Native internals

v1's `App.js` overrode `render` on `Text` and `TextInput` at module scope to inject a font and auto-translate string children, and patched `Alert.alert` the same way.

Consequences: a translation lookup on every string in every render pass; broken `React.memo`; **user-entered data silently corrupted** when a customer name or product name matched a translation key; breakage on RN upgrades; and components that cannot be unit-tested in isolation.

Localisation happens through explicit `t()` calls. Fonts are applied through the design-system component in `apps/mobile/src/ui/`. Nothing patches a prototype, ever.

### 4.2 Never create a god context

v1 had `MainDataShell` loading every entity into `AppDataContext`, which exposed ~80 memoised functions. Every consumer re-rendered when anything changed, and the whole dataset sat in the JS heap at boot.

Instead: small, purpose-scoped hooks that query projections with a `LIMIT`, per-screen. Never load "all customers" or "all baki entries" into memory. Lists are paginated and virtualised.

### 4.3 Never duplicate logic across client and server

v1 had eight trust-engine files existing in **both** `backend/services/trust/` and `frontend/hisab-app/services/customers/`. Two implementations of the same scoring logic will drift, and when they do there is no ground truth.

Shared logic lives in `packages/domain/` and is imported by both. If something can only run on the server, it lives on the server and the client calls it — it is not reimplemented client-side.

### 4.4 Never put a third-party secret in the client

Any `EXPO_PUBLIC_*` variable is inlined into the JS bundle and readable by anyone who unzips the APK. v1 shipped `EXPO_PUBLIC_ASSEMBLYAI_KEY`.

Third-party services are called from `server/`. The client calls our server. The only `EXPO_PUBLIC_*` variable permitted is `EXPO_PUBLIC_API_BASE_URL`.

### 4.5 Never add on-device general-purpose ASR

Whisper-tiny INT8 is 40–75 MB on disk and peaks at roughly 200–500 MB resident during inference. On a 2 GB device, where a foreground app realistically has 600–900 MB, that gets the app killed mid-transaction. Plus ONNX Runtime at 10–20 MB.

Voice, when it arrives in Phase 6, is closed-vocabulary keyword spotting: ~40 words (digits 0–9 in Bengali and English, ~15 intent words, control words), TFLite, target under 2 MB.

### 4.6 Never accept a PIN or any secret by voice

v1's voice FSM had a `WAIT_PIN` state with a confidence threshold of 1.00. Confidence protects against mis-transcription; it does not protect against the customer standing eighteen inches away. Do not implement voice authentication.

### 4.7 Never share customer data across shops

Within-shop only for v2. No global customer identity, no cross-shop lookup, no shared defaulter list, no trust score that leaves the device it was computed on.

A cross-shop defaulter registry would function as an unlicensed credit bureau operating on data subjects who never consented, with no dispute mechanism, targeting a population for whom informal credit is often the only credit available. It is documented as future work **with the harms analysis**, and it is not built.

### 4.8 Never show a risk score where a customer can see it

The counter phone is visible to the person standing in front of it. Overdue information is presented as **facts, not scores**: `৪৫ দিন ধরে কিছু দেননি`, never `উচ্চ ঝুঁকি` or a red HIGH RISK badge.

### 4.9 Never use barrel files for screens or components

`index.ts` files that re-export everything are merge-conflict magnets — both developers append an export line at the bottom of the same file. Import from the specific path.

The one exception is `packages/domain/src/index.ts`, which is a deliberate, jointly-owned API surface.

### 4.10 Never report MAPE for intermittent demand

Shop-level SKU demand has zero sales on most days. MAPE is undefined when the actual is zero and unstable when it is near zero. Use **MASE** and **RMSSE**. v1's research plan specified MAPE targets throughout; that was a mistake.

---

## 5. Commands

```bash
npm test                          # all workspaces
npm test -w packages/domain       # domain only — must run in under 5 seconds
npm run typecheck                 # tsc --noEmit, strict, all workspaces
npm run lint
npm run build:apk                 # release, arm64-v8a, per-ABI split
npm run size:check                # measures the APK against the 25 MB budget
npm run db:reset                  # drop projections, replay log, verify identical state
```

**Before saying a task is complete, run `npm test` and `npm run typecheck` and report the actual output.** Do not claim tests pass without running them.

---

## 6. Code conventions

- **TypeScript strict mode.** No `any`. No `@ts-ignore` without a comment explaining why and a linked issue.
- **Branded types for units.** `Poisha`, `Taka`, `Quantity`, `Days`. If a value has a unit, it gets a brand.
- **Errors are values in the domain layer.** `applyPayment` returns `Event[] | DomainError`, it does not throw. Exceptions are reserved for programmer error.
- **Naming:** `snake_case` for database columns, `camelCase` for TypeScript, `SCREAMING_SNAKE_CASE` for event type constants.
- **SQL migrations are numbered and append-only:** `001_events.sql`, `002_projections.sql`. Never edit a migration that has been merged.
- **Every domain function gets a unit test.** Financial rules additionally get property-based tests with `fast-check` — for any random sequence of credits and payments: the fold is order-independent under HLC sort, the balance never silently disagrees with the log, and correction events are idempotent.
- **Comments explain why, not what.** If the code needs a comment to explain what it does, rewrite the code.

### Bengali and localisation

- All user-facing strings go through `t()` in `apps/mobile/src/i18n/`, split by namespace (`bn/customers.ts`, `bn/products.ts`, `bn/common.ts`). Never one large locale file.
- Both `bn` and `en` keys are added in the same commit. A missing translation is a build failure, not a runtime fallback.
- **Indian digit grouping**: `12,34,567`, not `1,234,567`.
- **Numeral script is a user setting**, defaulting to Arabic numerals for money. Do not hardcode Bengali numerals (০-৯). Many shopkeepers read Arabic numerals faster for amounts because prices, banknotes, phone numbers, and calculators all use them. This is being tested empirically; until the data says otherwise, it is a setting.
- Bengali needs more line-height than Latin. Conjuncts (যুক্তাক্ষর) and the matra need vertical room. Test with `ক্ষ ঞ্জ স্ত্র ন্ত্র দ্ধ ট্ট` on Android 8, 9, and 10.
- Two font weights only: Regular and Bold. v1 loaded five Anek Bangla weights at boot.
- Left-align Bengali text. Do not centre long strings.

---

## 7. The event catalogue

`docs/EVENTS.md` is the authoritative list. Summary of the shape:

```ts
interface Event {
  id: string;            // UUIDv7, generated on-device — this is also the idempotency key
  device_id: string;
  seq: number;           // monotonic per device
  hlc: string;           // hybrid logical clock, for deterministic ordering
  shop_id: string;
  type: EventType;
  payload: unknown;      // JSON, validated against a versioned Zod schema
  created_at: number;    // device wall clock — untrusted, display only
  synced_at: number | null;
}
```

**Adding a new event type requires:** an entry in `docs/EVENTS.md`, a Zod schema, a `fold` case, a test, and an entry in `docs/DECISIONS.md`. Do not add one casually.

Idempotency is free: because event ids are device-generated UUIDs, the server uses `INSERT ... ON CONFLICT (id) DO NOTHING`. There is no idempotency hash table, no TTL, and no `IdempotencyRecord` model. Do not reintroduce one.

---

## 8. Security

`docs/SECURITY.md` has the full checklist. The rules an agent is most likely to violate:

- Never log PII. Log ids, never names, phone numbers, or amounts tied to an identity.
- Never store anything sensitive in `AsyncStorage` — it is unencrypted. Tokens and keys go in `expo-secure-store` (Android Keystore).
- Never add a third-party analytics SDK. Telemetry goes to our own endpoint and sends counts and timings, never content.
- Never write a monetary value or a customer name into a crash report.
- Never widen a data-collection form. If a field isn't used by a feature that exists, it doesn't get collected. v1's customer form asked for name, phone, address, credit limit, and due terms for someone standing at a counter; v2 asks for one field.

---

## 9. Research integrity

This repository backs a paper. Two rules apply to agents specifically:

**Never invent a citation, a statistic, or a benchmark number.** v1's draft abstract opened with "670 million informal retail transactions occur daily in South and Southeast Asia" with no source, and asserted that snarkjs implements Bulletproofs (it implements Groth16, PLONK, and FFLONK). Both would be serious problems in review.

If you don't know a number, say you don't know. If you're asked to write a related-work paragraph, cite only papers whose existence you can verify, and mark anything uncertain as `[VERIFY]`.

**Every quantitative claim goes in `research/claims.csv`** alongside the file, experiment, or log that produced it. If a claim has no evidence row, it does not go in the paper.

For models: **implement the baseline before the improvement.** Reproduce the paper's reported number on the paper's data first. Then run the baseline on our data — that is the floor. Anything that doesn't beat the floor gets deleted from the repository. v1 shipped a weighted ensemble of logistic regression, a Markov posterior, and an EMA signal with no evidence that it beat any single component.

---

## 10. Working style for agents

- **Ask before adding a dependency.** Always. See §3.4.
- **Ask before creating a new screen.** The six core screens ship first; a seventh needs a reason. See `docs/UI_SPEC.md`.
- **Prefer deleting code to adding it.** v1's problem was volume, not quality.
- **Small changes.** If a change touches more than about eight files, stop and propose splitting it.
- **When you find a violation of this document in existing code, report it — don't silently fix it in an unrelated PR.**
- **Record non-obvious decisions** by appending to `docs/DECISIONS.md`. Four lines: what was considered, what was chosen, why.
- **Say when you're unsure.** A wrong answer stated confidently costs more than a question. This is true of the code and doubly true of the research.
- If a request conflicts with §3 or §4, **say so and explain why** rather than complying or silently working around it.

---

## 11. Current phase

> **Update this section whenever the phase changes. Agents should read it to know what is in scope right now.**

**Phase:** 0 — field research and scaffold
**In scope:** repo scaffold, CI, size gate, domain types, event catalogue, shop visits, utterance collection
**Out of scope:** everything else, including all UI beyond the design-system gallery

**Exit criteria:** written findings from ≥10 shops; ≥300 collected utterances; empty-app APK baseline measured and recorded in `DECISIONS.md`; `types.ts` and `docs/EVENTS.md` agreed and committed; CI green.

Phase definitions are in `docs/BUILD_PLAN.md`.
