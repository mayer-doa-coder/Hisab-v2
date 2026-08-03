# BUILD_PLAN.md

**Referenced by:** `AGENTS.md` §11, `CONTRIBUTING.md` §9. This is the canonical phase table — if either of those files disagrees with this one, this file wins and the other is a bug to fix.

**Granular, Claude-Code-specific sub-steps** for Phase 0 live in the companion document `CLAUDE_CODE_STEP_01.md` (Step 1 = this file's Phase 0). That document breaks each phase into copy-pasteable prompts; this document defines what each phase must produce and when it's done. Read this one for *what*, that one for *how to prompt it*.

No week numbers, by design — there is no deadline. Each phase has an exit criterion. **The next phase does not start until the current one's exit criterion is met**, even if that feels slow.

---

## Phase 0 — Field research and the empty repo

**No feature code. This is the most important phase in the project.** There is no real data yet, and everything downstream — product decisions, the paper, the forecasting benchmark — depends on data that only accumulates in real time.

| Person | Tasks |
|---|---|
| **A (lead)** | Scaffold the repo. CI, the 25 MB size gate, TypeScript strict, branch protection. Build one empty Expo release APK and measure the actual baseline. |
| **A** | Prototype the event-log idea in ~100 lines of throwaway TS to confirm the fold behaves as expected. Throw it away afterwards. |
| **B (lead)** | Visit 10+ shops. Sit for an hour each. Photograph notebooks (with permission). Record page layout, columns, partial-payment handling, what's crossed out and why. Count credit entries/day, customers with open balances, median amount. Ask *"when did you last lose money because of the notebook?"* — concrete past events, not hypotheticals. Write it up in `research/field-notes/`. |
| **B** | Begin utterance collection immediately (`docs/RESEARCH.md` §4). This does not require the app to exist. |
| **Both** | Write `packages/domain/src/types.ts`, the viewmodels, and `docs/EVENTS.md` together, in one session. |

**Exit criteria:**
- Written findings document with real numbers from ≥10 shops
- ≥300 collected utterances
- Empty-app APK baseline measured and recorded in `docs/DECISIONS.md`
- `types.ts` and `EVENTS.md` agreed and committed
- CI green on the (still nearly empty) repo, including every guard proven to fail correctly

---

## Phase 1 — Domain core

No UI, no database, no network. Pure functions and tests only.

| Person | Tasks |
|---|---|
| **A** | `money.ts` with branded types. `events.ts` with `schema_version` from event #1. `fold.ts`. `commands.ts` — `applyCredit`, `applyPayment`, `applyCorrection`, each returning `Event[] \| DomainError`. `anomalies.ts` — negative balance, duplicate-payment detection. Property-based tests with `fast-check`: for any random sequence of credits and payments, the fold is order-independent under HLC sort; balance never silently disagrees; correction events are idempotent. |
| **B** | Design system in isolation, no data: `Amount`, `Button`, `Row`, `Keypad`, `Sheet`. A gallery screen showing every component. Typography scale. Test Bengali conjunct rendering on Android 8, 9, 10 with `ক্ষ ঞ্জ স্ত্র ন্ত্র দ্ধ ট্ট`. Decide the Bengali-vs-Arabic numeral default by timing shopkeepers reading amounts in both (`AGENTS.md` §6 — this is a setting, not a hardcoded default, until the data says otherwise). |
| **B** | i18n scaffold, namespaced. Explicit `t()` calls only. No prototype patching, ever. |

**Exit:** `npm test` in the domain package runs in under 5 seconds and covers every financial rule. B has a component gallery rendering correctly on a real low-end Android device.

---

## Phase 2 — Local storage and the core loop

Still no network. **This phase ships to one real shop.**

| Person | Tasks |
|---|---|
| **A** | SQLite: `events` table + `customers`/`balances` projections. `append()`, `since(seq)`, `rebuildProjections()`. Verify: drop every projection table, replay the log, get identical state. Wire viewmodels to the exact shapes agreed in Phase 0. |
| **B** | The six core screens (`docs/UI_SPEC.md`). The credit-entry flow is the one to obsess over. Draft state persisted to disk on every field change, not on submit. |
| **B** | Banglish + phonetic search matching Bangla name, Banglish name, and phone in one pass. |
| **Both** | Kill-the-app testing. Background the app at every step of every flow, repeatedly. Confirm nothing is lost and the user returns to exactly where they were. |

**Exit:** a shopkeeper uses it for a full day with no internet and loses nothing. Credit entry completes in **under 8 seconds, ≤5 taps**, timed with a stopwatch in a real shop. APK still under 25 MB.

Then: **install it on one shopkeeper's phone. Not five. One.** Watch what breaks.

---

## Phase 3 — Sync

| Person | Tasks |
|---|---|
| **A** | Server: auth, `POST /v1/events`, `GET /v1/events?since=`, health. Postgres. Idempotency is free from device-generated UUIDs + `ON CONFLICT DO NOTHING`. |
| **A** | Client sync: push unsynced, pull remote, background task, exponential backoff with jitter, circuit breaker. |
| **A** | Two-device convergence test as a **CI job**, not a manual check. Two simulated devices, both offline, both editing, both reconnecting → identical state or a clearly surfaced review item. |
| **A** | Security implementation — the full `docs/SECURITY.md` checklist. |
| **B** | Sync state in the UI: per-row pending/synced dot. No offline banner. The one loud warning: unsynced data at logout. |
| **B** | The anomaly review screen: two candidate duplicate payments side by side, one tap to void one. |

**Exit:** the convergence CI job passes. Local database is encrypted. Refresh tokens are device-bound and rotate.

---

## Phase 4 — Inventory and the aging view

| Person | Tasks |
|---|---|
| **A** | Products and stock movements as events. Stock = fold over movements. **No cached `Product.quantity` field** — that's the v1 bug. Low-stock and expiry rules in the domain layer. |
| **B** | Product list, add/edit product, alerts screen, daily summary. |
| **B** | The aging view — requirement 7, within-shop version. Who owes what, for how long, sorted by attention needed. Facts, not scores. This is the highest-value screen after credit entry; give it the most design attention. |

**Exit:** the shopkeeper answers "how much am I owed, by whom, and how long?" in one screen without scrolling.

Then: **expand the pilot to all 4–5 shops.** Real sales data starts accumulating here, which Phase 5 needs.

---

## Phase 5 — Forecasting and overdue rules

Do not start this until Phase 4 has been running in shops long enough to produce real data. Starting earlier means tuning models on seed data, which is how v1 ended up with an untested three-model ensemble.

| Person | Tasks |
|---|---|
| **A** | SBC demand classification (ADI / CV²) → route to SES / Croston / SBA / TSB / Markov. Reorder point with editable service level and lead time. Benchmark harness in the repo — this is the secondary paper contribution. Report MASE and RMSSE, never MAPE. Record model size in KB and inference latency in ms on a real budget phone. |
| **B** | Suggestion UI. Plain-language explanation on every suggestion. Shopkeeper-editable seasonal multipliers for Eid/Ramadan/monsoon — and log what they choose. Explicit "not enough data yet" state. |

**Exit:** every model beats a naive baseline on real pilot data. Anything that doesn't gets deleted from the repo.

---

## Phase 6 — Voice

| Person | Tasks |
|---|---|
| **A** | Closed-vocabulary keyword spotting: ~40 words (digits 0–9 in Bengali and English, ~15 intent words, control words). TFLite, target under 2 MB. Bengali/Arabic digit normalization. |
| **B** | Slot-filling flow UI. Always a visible touch fallback; two failures → hand back to touch. No PIN by voice, ever. |
| **Both** | Evaluation in a noisy shop. |

**Exit:** voice completes a credit entry faster than touch for at least some users, in a noisy environment, measured. APK still under the gate.

---

## Phase 7 — Optional

OCR (scope to digits and amounts first — full-page handwritten Bangla is genuinely hard). SMS reminders (check BTRC and Bangladesh Bank rules first). USSD (requires an operator relationship you likely don't have).

Not scheduled. Revisit only once Phases 0–6 are stable and in real use.

---

## What is deliberately not a phase

- **Field research and utterance collection never stop.** They start in Phase 0 and run continuously alongside every later phase. They are not "done" when Phase 0 ends.
- **Cross-shop credit sharing.** Explicitly out of scope for all of v2. Documented as future work with a harms analysis (`AGENTS.md` §4.7, `docs/RESEARCH.md` §10) — not a phase to eventually reach.
- **Paper writing.** Runs alongside Phases 0–6, fed by `research/claims.csv` and the field notes as they accumulate. It is not a Phase 8.
