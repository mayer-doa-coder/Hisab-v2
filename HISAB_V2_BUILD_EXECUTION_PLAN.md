# Hisab v2 — From-Scratch Execution Plan

**Companion to:** `HISAB_V2_REBUILD_AND_RESEARCH_PLAN.md`
**Team:** 2 people (referred to below as **A** and **B**)
**Context from your answers:** undergrad project with a research goal, supervisor present, no deadline, 4–5 shops of potential access, no real data yet, React Native for now, requirement 6 = protecting the user's own and sensitive data, requirement 7 = within-shop only for v2 with cross-shop as future scope.

---

## Part 0 — What your answers changed

Five things in the previous document are now settled, and two shift meaningfully.

**Settled:**

| Question | Your answer | Consequence |
|---|---|---|
| Q3 — deadline | None | You can build correctly instead of quickly. The build order in Part 5 has no week numbers by design. |
| Q7 — requirement 6 | Protecting user's own + sensitive data | Becomes a concrete checklist, Part 7. This is a normal, solvable engineering problem. |
| Q8 — requirement 7 | Within-shop now, cross-shop as future scope | Removes the ethics blocker entirely. Cross-shop belongs in the paper's *Future Work* section **with the harms analysis** — that discussion is a strength, not a liability. |
| Q2 — academic framing | Undergrad + supervisor + want to publish | Target ICCIT / BLP workshop tier. That is the right tier and a genuinely good outcome for an undergrad project. |
| Q6 — React Native | For now, open to change | See Part 2. Recommendation: stay on RN, but architect so a port costs weeks, not months. |

**Shifted:**

**Q4 — 4–5 shops.** This is enough for a *deep pilot* but not enough for a *dataset*. That distinction matters more than it sounds, and it changes the research recommendation. Details in Part 8, but briefly: collecting voice utterances doesn't need a pilot relationship — it needs 20 minutes at a counter. You can collect from 60 shopkeepers you don't pilot with. Pilot depth and data breadth are separate resources, and you should acquire them separately.

**Q5 — no real data.** This is now the single most urgent thing in the project. Every research option depends on it, and none of it accumulates faster than real time. Part 5's Phase 0 exists mainly to fix this, and it starts before any code.

---

## Part 1 — The app size question, answered

You asked: if you combine all thirteen requirements, what's the approximate APK size?

**Short answer: roughly 100–150 MB per-ABI, and more importantly it will not run on the devices you're targeting.**

Below is the reasoning, component by component, so you can check my arithmetic rather than trust it.

### 1.1 Component budget

These are estimates for a **release build, arm64-v8a only (per-ABI split), R8/ProGuard enabled, resource shrinking on**. Ranges are wide where the answer depends on build configuration.

| Component | Estimated size | Notes |
|---|---|---|
| **React Native + Expo runtime + Hermes** | 12–20 MB | This is your floor before writing a single feature. Bare RN with Hermes is lower (~7–9 MB); Expo's module system adds to it. |
| JS bundle (Hermes bytecode), ~15 screens | 2–5 MB | Grows with dependency count, not screen count. |
| expo-sqlite | 1–2 MB | SQLCipher variant is larger. |
| SQLCipher (for requirement 6/12) | +1–3 MB | Replaces or wraps the above. |
| Anek Bangla, 2 weights | 0.5–1.5 MB | Bengali conjunct coverage makes these fonts large. Five weights ≈ 1.5–3 MB. |
| Icon font / vector icons | 0.3–1.5 MB | Highly variable; tree-shaking helps a lot. |
| expo-camera (CameraX) | 2–4 MB | Needed for photo proof and OCR capture. |
| expo-audio | 0.5–1 MB | Needed for voice. |
| expo-image-picker | ~1 MB | |
| **Subtotal — everything except ML** | **~20–37 MB** | This is the realistic RN app *without* on-device AI. |
| **ONNX Runtime (react-native)** | 10–20 MB | A reduced/mobile build can reach ~5–8 MB but requires a custom ORT build, which is a non-trivial toolchain project on its own. |
| **Whisper-tiny, INT8 quantized, ONNX** | 40–75 MB | Encoder + decoder. "Tiny" is ~39M parameters; it is not a small file. Whisper-base is roughly double. |
| **On-device Bangla OCR** — text detector + CRNN recognizer + TFLite runtime | 8–18 MB | A MobileNet-based *character* recognizer alone is 1–4 MB, but full-page handwritten recognition needs detection + sequence recognition. |
| **Total, all requirements combined** | **≈ 80–150 MB per-ABI** | |

A **universal APK** (all ABIs in one file, which is what you get if you don't configure splits) is roughly 1.6–2.2× the native-library portion. That lands you at **150–250 MB**.

**Install size** (what actually occupies the user's storage after extraction) is typically **2–3× the download size**. So a 120 MB APK becomes roughly 250–350 MB installed, before any user data.

### 1.2 The constraint that actually kills it is RAM, not storage

This matters more than the APK number and gets discussed less.

On a 2 GB Android device, after the OS, the launcher, and background services, a foreground app realistically has somewhere in the region of 600–900 MB before the low-memory killer becomes interested in you. That budget is shared between:

- The Android runtime and your native heap
- The React Native JS heap (Hermes) — your v1's `AppDataContext` loading all entities into memory lives here
- ONNX Runtime's arena allocator during inference
- Whisper's activation tensors during a forward pass

Whisper-tiny INT8 inference peak resident memory is commonly in the **200–500 MB** range depending on audio length and runtime configuration. Add the RN heap with all your data loaded, and you are at or past the ceiling. The failure mode is not "slow" — it's the app being killed mid-transaction, which for a ledger app means the shopkeeper loses trust permanently.

**This is the real reason on-device Whisper is incompatible with requirement 4, independent of requirement 5.**

### 1.3 Target budgets — pick one and enforce it in CI

| Configuration | Estimated per-ABI APK | Runs well on 2 GB device? |
|---|---|---|
| **Native Kotlin, core features only** | 4–8 MB | Yes, comfortably |
| **RN/Expo, core features only** (no camera, no ML) | 15–22 MB | Yes |
| **RN/Expo, core + camera + photo proof** | 20–28 MB | Yes |
| **RN/Expo, core + keyword-spotting voice** (~40-word closed vocabulary, TFLite) | 24–34 MB | Yes — KWS model is 0.1–2 MB, TFLite runtime 2–3 MB |
| **RN/Expo, core + KWS + digits-only OCR** | 28–40 MB | Probably, with care |
| **RN/Expo, everything incl. on-device Whisper + full OCR** | 80–150 MB | **No** |

### 1.4 What to do about it

**Set the gate on day one.** Before you write feature code, add a CI job that builds a release APK and fails if it exceeds a number. Start the number at **25 MB**. Every dependency then has to argue against a hard limit instead of against a vague preference. In your v1, this single gate would have blocked ONNX Runtime, BullMQ, three of the five font weights, and the ONNX voice pack downloader.

```yaml
# .github/workflows/size-gate.yml  (owner: A)
- name: Enforce APK budget
  run: |
    SIZE=$(stat -c%s app-arm64-v8a-release.apk)
    LIMIT=$((25 * 1024 * 1024))
    echo "APK: $((SIZE/1024/1024)) MB  |  Limit: 25 MB"
    if [ "$SIZE" -gt "$LIMIT" ]; then
      echo "::error::APK budget exceeded"
      exit 1
    fi
```

Also enable, from the first build config:
- Per-ABI APK splits (or an Android App Bundle, which does this automatically on Play)
- Hermes (default in modern RN, but confirm)
- R8 full mode + `shrinkResources true`
- `enableProguardInReleaseBuilds = true`

And measure with `apkanalyzer` or Android Studio's APK Analyzer rather than guessing — the numbers above are estimates from component-level reasoning, not measurements of your specific build. **Verify the baseline in Phase 1, before the code makes it hard to change course.**

---

## Part 2 — React Native vs. the alternatives, specific points only

You said RN for now, open to change. Here's the specific case each way, and then a recommendation that lets you defer the decision cheaply.

### React Native / Expo

**Advantages, specific to your situation:**

1. **One language across app, server, and domain logic.** Your financial logic — `fold(events)`, `applyPayment`, `reorderPoint` — can live in a single TypeScript package imported by both the mobile app and the Node server. This structurally eliminates the trust-engine duplication that exists twice in your v1. For a two-person team this is a large, concrete saving.
2. **EAS Build removes the Android toolchain from your machines.** Two undergrads sharing builds without both maintaining a working local Android SDK is worth real time.
3. **EAS Update ships JS fixes without a Play Store round trip.** During a pilot at 4–5 shops, being able to fix a bug the same afternoon — instead of asking a shopkeeper to reinstall — is the difference between a pilot that produces data and one that produces excuses.
4. **Some v1 work is reusable as reference:** `banglishSearch.js`, `numerals.js`, and the locale key structure are ideas you can carry forward even though the code around them isn't.

**Disadvantages, specific:**

1. **APK floor of 12–20 MB before your first feature.** Kotlin's equivalent floor is roughly 2–3 MB. If requirement 5 is a hard constraint, you are spending 15 MB on the runtime alone.
2. **Cold start penalty.** JS bundle load + Hermes initialization + font parsing happens *after* native app start. On a low-end device this is measurable, and it's the first thing a shopkeeper experiences.
3. **Two heaps.** The JS heap and the native heap coexist and both count against the same RAM budget. On a 2 GB device this effectively halves your usable memory.
4. **List performance is where RN visibly degrades.** A `FlatList` of 500+ customer rows with Bengali text on a low-end device will drop frames in a way a native `RecyclerView` will not. Your customer list is one of your two most-used screens.
5. **On-device ML options are narrower and heavier.** You go through `onnxruntime-react-native` or `react-native-fast-tflite` rather than calling TFLite directly. Fewer options, less mature, more bytes.
6. **SQLCipher integration is more constrained** than in native Android, where Room + SQLCipher is a well-trodden path.

### Native Android (Kotlin)

**Advantages:** smallest APK by a wide margin (4–8 MB for this app); best cold start; direct Room + SQLCipher; direct TFLite with no bridge; `RecyclerView` performance; the most control over Bengali text shaping, which matters on Android 8–10.

**Disadvantages:** your domain logic must either be reimplemented for the Node server or you write the server in Kotlin/Ktor too; no over-the-air updates during the pilot; if neither of you knows Kotlin, the learning curve competes directly with the research work.

### Flutter

**Advantages:** single codebase; good performance; APK around 8–15 MB; Flutter renders text with its own engine, which gives you control over Bengali shaping independent of the Android version.

**Disadvantages:** Dart means the shared-domain-with-Node approach is gone; Flutter's own text engine has its own Bengali conjunct quirks that you'd need to test independently; a third language for a two-person team with a research deliverable.

### Recommendation

**Stay on React Native for v2. Drop on-device Whisper permanently. Enforce a 25 MB gate.**

The shared TypeScript domain package is worth more to a two-person team than the 10–15 MB you'd save in Kotlin, and it removes an entire class of bug that your v1 actually had.

But architect so that changing your mind is cheap:

> **The domain layer must be pure TypeScript with zero imports from `react`, `react-native`, `expo`, `fetch`, or any database.** If that rule holds, porting to Kotlin later is a mechanical translation of pure functions with a test suite that already defines correct behaviour. Porting a domain layer tangled into React contexts and SQLite calls — which is what v1 has — is a rewrite.

If, after Phase 4, the 25 MB gate proves unachievable or measured performance on a real ৳10,000 phone fails, port the UI to Kotlin. And note: *"we implemented the same domain layer on both stacks and measured APK size, cold start, and list scroll performance on identical low-end hardware"* is itself a publishable systems result. Your constraint can become your contribution.

---

## Part 3 — Repository scaffold, from empty

Create a **new repository**. Do not fork or branch the old one. Archive `Hisab` as `Hisab-v1` and mark it read-only in the README so it stays available as a reference and as evidence of prior work for your thesis.

### 3.1 Directory structure

The structure below is designed around one goal beyond clarity: **every directory has exactly one owner**, so two people can work in parallel indefinitely without touching the same files.

```
hisab/
├── .github/
│   └── workflows/
│       ├── ci.yml                    [A]  test + lint + typecheck
│       └── size-gate.yml             [A]  APK budget enforcement
│
├── packages/
│   └── domain/                       [A]  pure TS, zero I/O, the heart of the system
│       ├── src/
│       │   ├── types.ts              [SHARED — see §4.3]
│       │   ├── index.ts              [SHARED — the public API surface]
│       │   ├── money.ts              [A]
│       │   ├── events.ts             [A]
│       │   ├── fold.ts               [A]
│       │   ├── commands.ts           [A]
│       │   ├── anomalies.ts          [A]
│       │   ├── overdue.ts            [A]
│       │   └── forecast/             [A]  Phase 5
│       ├── test/                     [A]
│       └── package.json              [A]
│
├── apps/
│   └── mobile/
│       ├── src/
│       │   ├── data/                 [A]  SQLite, event store, projections
│       │   ├── sync/                 [A]  push/pull, backoff, background task
│       │   ├── security/             [A]  key derivation, encrypted DB, keystore
│       │   │
│       │   ├── ui/                   [B]  design system primitives
│       │   ├── screens/              [B]  one file per screen
│       │   ├── navigation/           [B]
│       │   ├── i18n/                 [B]  see §4.4 — split by namespace
│       │   ├── search/               [B]  banglish + phonetic matching
│       │   └── viewmodels/           [SHARED — see §4.3]
│       │
│       ├── app.json                  [A]
│       └── package.json              [A]  A owns all dependency changes
│
├── server/                           [A]
│   ├── src/
│   │   ├── routes/
│   │   ├── db/
│   │   └── index.ts
│   └── package.json
│
├── research/                         [B]
│   ├── field-notes/                  [B]  Phase 0 shop visit writeups
│   ├── literature/
│   │   └── extraction.csv            [B]  the paper table from the prior doc
│   ├── dataset/                      [B]  utterance collection
│   └── claims.csv                    [B]  every quantitative claim → its evidence
│
├── docs/
│   ├── DECISIONS.md                  [SHARED — append-only, see §4.5]
│   ├── EVENTS.md                     [A]  the event catalogue
│   └── UI_SPEC.md                    [B]
│
├── .gitignore
├── .nvmrc
├── package.json                      [A]  workspace root
└── README.md                         [SHARED — edit rarely]
```

### 3.2 Setup commands, in order

Run these together, in one sitting, both of you present. This is the only time you'll both be writing to the same files.

```bash
mkdir hisab && cd hisab && git init
npm init -y

# npm workspaces — keeps domain, mobile, and server in one repo with shared deps
npm pkg set workspaces[0]="packages/*" workspaces[1]="apps/*" workspaces[2]="server"

# 1. Domain package FIRST. Nothing else can be built before this exists.
mkdir -p packages/domain/src packages/domain/test
cd packages/domain && npm init -y
npm i -D typescript vitest @types/node fast-check   # fast-check = property-based testing
cd ../..

# 2. Mobile app
npx create-expo-app apps/mobile --template blank-typescript

# 3. Server
mkdir -p server/src && cd server && npm init -y
npm i express pg zod && npm i -D typescript tsx @types/express
cd ..

# 4. Tooling
npm i -D typescript eslint prettier @typescript-eslint/parser @typescript-eslint/eslint-plugin

git add -A && git commit -m "chore: workspace scaffold"
git branch -M main
```

Then, before either of you writes a feature:

```bash
# Protect main
# GitHub → Settings → Branches → Add rule for `main`:
#   ☑ Require a pull request before merging
#   ☑ Require status checks to pass (ci)
#   ☑ Require branches to be up to date before merging
#   ☐ Do NOT require approvals — with 2 people that's a bottleneck, not a safeguard
```

### 3.3 TypeScript from the start

Your v1 is JavaScript. Use TypeScript in v2 and turn on `strict`. For a financial application this is not a preference — it's how you make `Poisha` a distinct type from `number` so the compiler catches unit-mixing bugs that runtime testing would miss:

```ts
// packages/domain/src/money.ts
export type Poisha = number & { readonly __brand: 'Poisha' };
export type Taka   = number & { readonly __brand: 'Taka' };

export const fromTaka = (t: number): Poisha => Math.round(t * 100) as Poisha;
export const add = (a: Poisha, b: Poisha): Poisha => (a + b) as Poisha;
export const toDisplayTaka = (p: Poisha): string => (p / 100).toFixed(2);
```

Now `add(customerBalance, productPrice)` compiles only if both are `Poisha`. A raw `number` from a form field will not typecheck until it's passed through `fromTaka`. That single pattern eliminates the mixed `amount` / `amountCents` problem your v1 has.

---

## Part 4 — Working as two people without merge conflicts

Merge conflicts happen when two people edit the same lines of the same file. Everything below is designed to make that structurally impossible rather than merely unlikely.

### 4.1 The core rule: own directories, not features

**A = Core & Data.** Domain layer, event store, SQLite, projections, sync, server, security, CI.
**B = Interface & Field.** Design system, screens, navigation, i18n, search, field research, dataset, paper.

Neither person ever edits a file in the other's directory. If B needs a change in the domain layer, B opens an issue or messages A; A makes the change. This feels slow for about three days and then feels obviously correct.

Rough balance check: A has more code; B has the shop visits, the dataset collection, and the paper, which are the calendar-heavy items. This works out.

### 4.2 Files that cause conflicts, and what to do about each

| Conflict source | Rule |
|---|---|
| `package.json` / `package-lock.json` | **A owns all dependency changes.** B never runs `npm install <pkg>`. B requests; A adds it in a standalone PR merged the same day. Lockfile conflicts are the #1 cause of pain in small teams. |
| Barrel files (`index.ts` re-exporting everything) | **Don't use them for screens or components.** They are conflict magnets — both people append an export line at the end. Import from the specific file path instead. |
| A single `locales/bn.js` | **Split by namespace.** `i18n/bn/customers.ts`, `i18n/bn/products.ts`, `i18n/bn/common.ts`. Both people never edit one giant file. (B owns all of these; the split still helps when B works across sessions.) |
| Navigation route registry | B owns it entirely. A never adds a screen. |
| SQL migration files | **Numbered, append-only, never edited after merge**: `001_events.sql`, `002_projections.sql`. A owns all of them. |
| `README.md` | Edit rarely, and never in the same PR as code. |

### 4.3 The contract: shared files, written once, together

Exactly three things are jointly owned. Write them in a single session, both present, commit once, and after that a change requires both of you to agree.

**1. `packages/domain/src/types.ts`** — the event and command types. This is the whole interface between A's world and B's world.

**2. `packages/domain/src/index.ts`** — the public API. B imports only from here. If it isn't exported here, B can't use it.

**3. `apps/mobile/src/viewmodels/`** — the shapes B's screens render. A produces them, B consumes them.

```ts
// apps/mobile/src/viewmodels/customer.ts — agreed jointly, changed jointly
export interface CustomerRowVM {
  id: string;
  displayName: string;        // the nickname, what the shopkeeper calls them
  balanceDisplay: string;     // pre-formatted — B does not do money arithmetic
  daysSinceActivity: number;
  needsAttention: boolean;    // computed by domain, rendered by UI
  attentionReason: string | null;  // plain language, e.g. "৪৫ দিন ধরে কিছু দেননি"
  syncPending: boolean;
}
```

Note what this does: **B never performs arithmetic on money and never decides who is overdue.** Those are domain concerns, already tested. B renders strings. That boundary is what makes parallel work safe.

Write these three files in Phase 1, Day 1, before anything else. Everything downstream depends on them, and if they're wrong you find out immediately instead of in Phase 3.

### 4.4 Git workflow

```bash
# Branch naming — the prefix says who owns it, so you never look at each other's branches
git checkout -b a/event-store
git checkout -b b/customer-list-screen

# Before every push, ALWAYS rebase — never merge main into your branch
git fetch origin
git rebase origin/main
git push --force-with-lease
```

**Rules:**
- **Merge to `main` at least once a day.** A branch that lives a week will conflict no matter how well you divide directories, because refactors happen.
- **Small PRs.** One screen. One module. If a PR touches more than ~8 files, it's too big.
- **Squash merge.** Keeps `main` history readable, which matters when you write the thesis and need to reconstruct what happened when.
- **CI must be green.** No exceptions, including for "small" changes.
- **No approvals required.** With two people, mandatory review is a blocker. Instead: read each other's merged PRs at the end of the day. You'll catch things without gating.

### 4.5 `docs/DECISIONS.md` — append-only

Every non-obvious decision gets four lines. Append at the bottom; never edit an existing entry. This makes the file conflict-free and gives you your thesis's "design rationale" chapter for free.

```markdown
## 2026-08-15 — Money stored as integer poisha
Considered: float taka, decimal library, integer poisha.
Chose: integer poisha, branded TS type.
Because: eliminates float rounding; branded type makes unit-mixing a compile error.

## 2026-08-20 — No on-device Whisper
Considered: ONNX Whisper-tiny, cloud ASR via backend, closed-vocabulary KWS.
Chose: KWS, deferred to Phase 6.
Because: Whisper-tiny INT8 is 40–75 MB and 200–500 MB peak RAM; breaks reqs 4 and 5.
```

---

## Part 5 — Build order, with the work split

No week numbers. Each phase has an exit criterion; you don't start the next one until it's met.

---

### PHASE 0 — Field research and the empty repo

**This phase has no feature code and it is the most important phase in the project.** You have no data. Everything downstream — product decisions, the paper, the forecasting benchmark — depends on data that only accumulates in real time. Start it now.

| Person | Tasks |
|---|---|
| **B (lead)** | Visit 10+ shops. Sit for an hour each. Photograph notebooks (with permission). Record: page layout, what columns exist, what happens on partial payment, what's crossed out and why. Count credit entries per day, customers with open balances, median amount. Ask *"when did you last lose money because of the notebook?"* — concrete past events, not hypothetical futures. Write it all up in `research/field-notes/`. |
| **B** | Begin utterance collection immediately (see Part 8). Every shop visit yields 30–50 recorded utterances. This does not require the app to exist. |
| **A (lead)** | Scaffold the repo (Part 3). Set up CI, the 25 MB size gate, TypeScript strict mode, branch protection. Build one empty Expo release APK and **measure the actual baseline** — you need the real number, not my estimate. |
| **A** | Prototype the event-log idea in ~100 lines of throwaway TS to confirm the fold behaves as expected. Throw it away afterwards. |
| **Both** | Write `packages/domain/src/types.ts` and the viewmodels together. Write `docs/EVENTS.md` — the full event catalogue. Record the RN-vs-Kotlin decision in `DECISIONS.md` with the measured baseline as evidence. |

**Exit criteria:**
- A written findings document with real numbers from ≥10 shops
- ≥300 collected utterances
- Empty-app APK baseline measured and recorded
- `types.ts` and `EVENTS.md` agreed and committed
- CI green on an empty repo

---

### PHASE 1 — Domain core

No UI, no database, no network. Pure functions and tests.

| Person | Tasks |
|---|---|
| **A** | `money.ts` with branded types. `events.ts` with `schema_version` from event #1. `fold.ts`. `commands.ts` — `applyCredit`, `applyPayment`, `applyCorrection`, each returning `Event[] \| DomainError`. `anomalies.ts` — negative balance, duplicate-payment detection. **Property-based tests with fast-check:** for any random sequence of credits and payments, the fold is order-independent under HLC sort; balance never silently disagrees; correction events are idempotent. |
| **B** | Design system in isolation, with no data: `Amount`, `Button`, `Row`, `Keypad`, `Sheet`. Build a Storybook-style gallery screen showing every component. Typography scale. **Test Bengali conjunct rendering on Android 8, 9, and 10** with `ক্ষ ঞ্জ স্ত্র ন্ত্র দ্ধ ট্ট`. Decide the Bengali-vs-Arabic numeral default by timing shopkeepers reading amounts in both — this is a real, small experiment and a candidate figure for your paper. |
| **B** | i18n scaffold, namespaced. Explicit `t()` calls only. **No prototype patching, ever.** |

**Exit:** `npm test` in the domain package runs in under 5 seconds and covers every financial rule. B has a component gallery rendering correctly on a real low-end Android device.

---

### PHASE 2 — Local storage and the core loop

Still no network. **This phase ships to one real shop.**

| Person | Tasks |
|---|---|
| **A** | SQLite: `events` table + `customers` / `balances` projections. `append()`, `since(seq)`, `rebuildProjections()`. Verify: delete every projection table, replay the log, get identical state. Wire viewmodels — A produces the exact shapes agreed in Phase 0. |
| **B** | The six core screens (Part 6). The credit-entry flow is the one to obsess over. Draft state persisted to disk on every field change, not on submit. |
| **B** | Banglish + phonetic search matching Bangla name, Banglish name, and phone in one pass. |
| **Both** | Kill-the-app testing. Background the app at every step of every flow, repeatedly, and confirm nothing is lost and the user returns to exactly where they were. |

**Exit:** a shopkeeper uses it for a full day with no internet and loses nothing. Credit entry completes in **under 8 seconds, ≤5 taps**, timed with a stopwatch in a real shop. APK still under 25 MB.

Then: **install it on one shopkeeper's phone.** Not five. One. Watch what breaks.

---

### PHASE 3 — Sync

| Person | Tasks |
|---|---|
| **A** | Server: auth, `POST /v1/events`, `GET /v1/events?since=`, health. Postgres. Idempotency comes free from device-generated UUIDs + `ON CONFLICT DO NOTHING`. |
| **A** | Client sync: push unsynced, pull remote, background task, exponential backoff with jitter, circuit breaker. |
| **A** | **Two-device convergence test as a CI job.** Two simulated devices, both offline, both editing, both reconnecting → identical state or a clearly surfaced review item. Automated, not manual. |
| **A** | Security implementation — the full Part 7 checklist. |
| **B** | Sync state in the UI: per-row pending/synced dot. **No offline banner** — offline is the normal state. The one loud warning: unsynced data at logout. |
| **B** | The anomaly review screen: two candidate duplicate payments side by side, one tap to void one. |

**Exit:** the convergence CI job passes. Local database is encrypted. Refresh tokens are device-bound and rotate.

---

### PHASE 4 — Inventory and the aging view

| Person | Tasks |
|---|---|
| **A** | Products and stock movements as events. Stock = fold over movements. **No cached `Product.quantity` field** — that's the v1 bug. Low-stock and expiry rules in the domain layer. |
| **B** | Product list, add/edit product, alerts screen, daily summary. |
| **B** | **The aging view — requirement 7, within-shop.** Who owes what, for how long, sorted by attention needed. Facts, not scores: *"৪৫ দিন"*, never *"উচ্চ ঝুঁকি"*. This is your highest-value screen; give it the most design attention after credit entry. |

**Exit:** the shopkeeper answers "how much am I owed, by whom, and how long?" in one screen without scrolling.

Then: **expand the pilot to all 4–5 shops.** Real sales data starts accumulating here, which is what Phase 5 and Option D need.

---

### PHASE 5 — Forecasting and overdue rules

Do not start this until Phase 4 has been running in shops long enough to produce data. If you start it earlier you'll be tuning models on `seedData.js`, which is how v1 ended up with an untested three-model ensemble.

| Person | Tasks |
|---|---|
| **A** | SBC demand classification (ADI / CV²) → route to SES / Croston / SBA / TSB / Markov. Reorder point with editable service level and lead time. **Benchmark harness in the repo** — this *is* Option D's experiment. Report MASE and RMSSE, never MAPE (undefined when actuals are zero, which is most days). Record model size in KB and inference latency in ms on a real budget phone. |
| **B** | Suggestion UI. Plain-language explanation on every suggestion. Shopkeeper-editable seasonal multipliers for Eid/Ramadan/monsoon — and **log what they choose**, because that's data nobody else has. Explicit "not enough data yet" state. |

**Exit:** every model beats a naive baseline on *your* data. Anything that doesn't gets deleted from the repo.

---

### PHASE 6 — Voice

| Person | Tasks |
|---|---|
| **A** | Closed-vocabulary keyword spotting: ~40 words (digits 0–9 in both Bengali and English, ~15 intent words, control words). TFLite, target under 2 MB. Bengali/Arabic digit normalization. |
| **B** | Slot-filling flow UI. Always a visible touch fallback; two failures → hand back to touch. **No PIN by voice.** |
| **Both** | Evaluation in a noisy shop — this is Option A's benchmark if you chose it. |

**Exit:** voice completes a credit entry faster than touch for at least some users in a real shop, measured. APK still under the gate.

---

### PHASE 7 — Optional

OCR (scope to digits and amounts first — full-page handwritten Bangla is genuinely hard, and the gap between isolated-character accuracy and real-world page accuracy is large). SMS reminders (check BTRC and Bangladesh Bank rules first). USSD requires an operator relationship you likely don't have.

---

## Part 6 — The core features, defined precisely

"Core" means: **if this doesn't work, nothing else matters.** Six screens. Build these, ship them, and resist adding a seventh until a shopkeeper has used all six for two weeks.

| # | Screen | Must do | Must NOT do |
|---|---|---|---|
| 1 | **Home** | Total owed to me. One large button: "বাকি লিখুন". Recent activity list. | No KPI grid, no charts, no period selector |
| 2 | **Customer list** | Recent-first ordering. Name + balance + days-since-activity. Search across Bangla/Banglish/phone. | Not alphabetical. No risk badges. |
| 3 | **Add customer** | **One required field: what you call them.** Phone optional. | Not five fields. No credit limit, no due terms, no address at creation. |
| 4 | **Record credit** | Who → how much → done. Full-screen keypad. Quick chips ৫০/১০০/২০০/৫০০/১০০০. Undo for 10s. | No spinner. No confirmation dialog. No system keyboard for the amount. |
| 5 | **Record payment** | Same flow. Pre-filled with the full balance, editable. | No spinner. |
| 6 | **Customer detail** | Running balance, full history, "show customer" mode (large, clean, customer-facing). | No risk score anywhere a customer might see it. |

**Acceptance criteria for the core, all measured in a real shop, not on your laptop:**

- Credit entry: **< 8 seconds, ≤ 5 taps**, from home screen to confirmed
- Cold start to interactive: **< 3 seconds** on a 2 GB device
- Customer list scrolls at 60fps with 500 customers
- App survives being backgrounded at every step of every flow
- Zero network calls in any core flow
- APK ≤ 25 MB per-ABI

Why recency-first ordering, nicknames, a custom keypad, undo-instead-of-confirm, no spinners, and the customer-facing view all matter — the reasoning is in §5.2 of the companion document. It's worth rereading before B starts Phase 2.

---

## Part 7 — Requirement 6, now that it's defined

You said requirement 6 means protecting the user's own data and sensitive information. That's a tractable checklist. **A owns all of this.**

### At rest, on the device

- **Encrypt the SQLite database with SQLCipher.** Derive the key from the user's PIN using Argon2id (or PBKDF2 with a high iteration count if Argon2 isn't practical in your RN setup), with a salt stored in Android Keystore. The key is never written to disk in plaintext. Changing the PIN re-keys the database.
- Store nothing sensitive in `AsyncStorage` — it's unencrypted. Tokens and keys go in `expo-secure-store`, which is backed by Android Keystore.
- Baki photos go in app-internal scoped storage, never in shared media directories where the gallery and other apps can read them.
- Set `android:allowBackup="false"` so ADB backup can't extract the database.
- `FLAG_SECURE` on screens showing balances and customer lists — blocks screenshots and screen recording, and blanks the app in the recents view.

### In transit

- TLS only. Reject plaintext HTTP even in development builds that could ship.
- Certificate pinning on your API domain.
- **No third-party API keys in the client, ever.** Any `EXPO_PUBLIC_*` variable is inlined into the JS bundle and readable by anyone who unzips the APK. Your v1 has `EXPO_PUBLIC_ASSEMBLYAI_KEY` — rotate it now if it's real. Cloud services are called from your server.

### Authentication

- PIN hashed with bcrypt or Argon2, server-side. Never stored in plaintext or reversibly on the device.
- Refresh tokens bound to a device fingerprint, rotated on every use. Use from a different fingerprint → revoke the whole token family and log a security event. (Your v1 plan gets this right; keep it.)
- Rate-limit PIN attempts with exponential lockout.

### Data minimisation — the part most people skip

- **Don't collect what you don't need.** Your v1's `CustomerForm` collects name, phone, address, credit limit, and due terms for someone standing at a counter. Address in particular is a liability with no clear use.
- **Reconsider `CustomerPhotoCapture`.** Photographing a person as proof of a debt stores biometric-adjacent data about a third party who never consented and never installed your app. If you keep it, make it opt-in per entry, never a default, and let the shopkeeper delete it.
- No PII in logs, crash reports, or analytics events. Log IDs, never names or phone numbers.
- **No third-party analytics SDK.** Your own telemetry endpoint, sending event counts and timings, never content.

### For the pilot specifically

- Written consent from each shopkeeper, in Bengali, explaining what is collected and how to withdraw
- A documented way for a shopkeeper to export and delete all their data
- Check whether your university requires ethics/IRB approval — it likely does for a pilot with human subjects, and approval can take weeks. Start that process during Phase 0.

---

## Part 8 — Research plan, revised for your answers

Your constraints: a pair, undergrad, no deadline, 4–5 shops, no data yet, want a publication.

### 8.1 The distinction that changes the recommendation

**4–5 shops gives you pilot *depth*, not dataset *breadth*.** These are different resources acquired in different ways:

- A **pilot** requires a relationship: you install software on someone's phone and they use it for months. 4–5 is realistic and appropriate.
- An **utterance collection** requires 20 minutes at a counter: you ask a shopkeeper to say how they'd record various transactions, and you record it. You can do this with 60+ shopkeepers you have no other relationship with. There's a market on nearly every street.

That's why Option A remains open to you despite having only 4–5 pilot shops.

### 8.2 Recommendation: Option A as the primary paper, Option D as the second

**Primary — Option A: a code-switched Bangla–English transactional command dataset and benchmark.**

Why it fits you specifically:
- It doesn't depend on the app being finished. Collection starts in Phase 0 and runs in parallel with all the engineering.
- 60 shopkeepers × ~40 utterances ≈ 2,400 utterances. Achievable by two people over months with no deadline.
- Dataset papers are the most reliably publishable first paper: the contribution is unambiguous, the evaluation is standard (BanglaBERT, BanglishBERT, mBERT, MuRIL, XLM-R, plus a multilingual LLM zero-shot and few-shot), and the artifact gets reused, which drives citations.
- It directly serves requirements 3 and 10, so the research and the product are the same work.
- The gap looks real. There's substantial code-mixed Bangla work — TB-OLID, BnSentMix, BanglishRev, SentMix-3L / EmoMix-3L / OffMix-3L — but I could find nothing on transactional **intent + slot filling**, which is a structurally different problem: it needs slot extraction (person, amount, quantity, unit, date) over Bengali *and* Arabic numerals, with Banglish transliteration variation, and with person names that are out-of-vocabulary by construction.

**Critical constraint:** collect from real shopkeepers. Do not synthesise utterances yourself or with an LLM. Reviewers will ask, and synthetic data would undermine the entire contribution.

**Second — Option D: on-device intermittent-demand forecasting for Bangladeshi kirana SKUs.**

This one comes nearly free: once Phase 4 ships to your 4–5 pilot shops, sales data accumulates automatically. The benchmark harness is Phase 5 work you're doing anyway. The differentiator is the on-device angle — model size in KB, inference latency in ms, battery cost on a real budget phone — which is genuinely underexplored.

4–5 shops is thin for a forecasting paper. Mitigate by running longer (you have no deadline) and by being explicit about the limitation rather than hiding it. Reviewers accept honest small-N far more readily than inflated claims.

**Your field notes from Phase 0 and the pilot become a qualitative section** in either paper, and give you the citable local numbers your introduction needs.

### 8.3 The cross-shop question, as future work

You said within-shop first, cross-shop as future scope. That's the right call, and it's worth writing about explicitly.

A *Future Work* section that says "we deliberately scoped to within-shop because a cross-shop defaulter registry would function as an unlicensed credit bureau operating on data subjects who never consented, with no dispute mechanism, targeting a population for whom informal credit is often the only credit available" is a **strength**. It shows you thought about consequences. Reviewers at ICTD-adjacent venues respond well to that. The version that proposes cross-shop scoring without engaging the harms is the one that gets rejected.

### 8.4 Division of research work

| Person | Owns |
|---|---|
| **B** | Dataset collection, annotation protocol, inter-annotator agreement, `research/literature/extraction.csv`, `research/claims.csv`, related-work drafting, ethics/IRB, shop relationships |
| **A** | Baseline model implementation and benchmarking, the Phase 5 forecasting harness, on-device latency/size measurement, evaluation tables and figures |
| **Both** | Paper writing. B drafts introduction / related work / method; A drafts evaluation; both edit everything. |

### 8.5 Two things to start this week

1. **`research/claims.csv`** — every quantitative claim you intend to make, and the file, experiment, or log that supports it. This is what prevents the "670 million transactions" problem in your v1 draft abstract.
2. **Zotero**, with the browser connector and BibTeX export into your LaTeX project. Never type a citation by hand. Never cite a paper you haven't opened.

### 8.6 Venues

Start at **ICCIT** (IEEE Bangladesh Section, IEEE Xplore indexed, historically around 31% acceptance). Check `iccit.org.bd` for the current cycle's deadline yourself — I haven't verified it. For Option A specifically, the **BLP (Bangla Language Processing) workshop**, which has co-located with EMNLP, is the better topical fit. ICISET, ICEEICT, and NSysS are reasonable second options.

Avoid aggregator-listed conferences that emphasise fees and certificates over review. Verify: IEEE or ACM sponsorship, a named technical programme committee with real affiliations, and past proceedings actually present in IEEE Xplore or the ACM DL.

---

## Part 9 — The first two weeks, concretely

| Day | A | B |
|---|---|---|
| 1 | *Together:* archive v1 as read-only. Create the new repo. Run the Part 3 scaffold. | *(same)* |
| 1 | *Together:* write `types.ts`, viewmodels, `docs/EVENTS.md`. Commit once. | *(same)* |
| 2 | CI, lint, TypeScript strict, branch protection | Plan shop visits; write the observation protocol and consent form |
| 3 | Build an empty Expo release APK; **measure it**; record in `DECISIONS.md` | Shop visits 1–2 |
| 4 | `money.ts` with branded types + tests | Shop visits 3–4 |
| 5 | `events.ts`, `fold.ts` + property-based tests | Write up field notes; start the utterance protocol |
| 6–7 | `commands.ts`, `anomalies.ts` + tests | Shop visits 5–7; first utterance recordings |
| 8 | Size gate wired into CI | Design system: `Amount`, `Button`, `Row` |
| 9 | Domain test coverage to 100% of financial rules | `Keypad` component; test on a real low-end device |
| 10 | Start `data/` — event store schema | Bengali conjunct rendering test on Android 8/9/10 |
| 11–12 | Projections + rebuild-from-log verification | Shop visits 8–10; numeral-reading timing experiment |
| 13 | — | Write up Phase 0 findings document |
| 14 | *Together:* review findings. Confirm or revise the core-screen list against what you actually saw. Update `DECISIONS.md`. | *(same)* |

Day 14 is the checkpoint that matters. You will have seen ten notebooks and will know things about how baki actually works that no amount of architecture can substitute for. **Let those findings override anything in this document that contradicts them.**

---

## Summary — the five rules

1. **The domain layer has zero I/O.** No React, no SQLite, no fetch. It makes financial logic testable in milliseconds and makes a future Kotlin port mechanical instead of a rewrite.
2. **Own directories, not features.** A owns core and data; B owns interface and field. Three shared files, written together once.
3. **25 MB APK gate in CI from day one.** Every dependency argues against a number.
4. **Six screens before a seventh.** Ship to one shop, then five. Your v1 had fifty screens and no test suite.
5. **Data collection starts before code.** You have no data, no deadline, and 4–5 shops. Time is the only thing that produces the data, so start the clock now.
