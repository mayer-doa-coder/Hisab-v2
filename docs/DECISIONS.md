# DECISIONS.md

**Append-only.** Add new entries at the bottom. **Never edit or delete an existing entry** — that is what makes this file conflict-free with two people writing to it, and what makes it usable as the design-rationale chapter of the thesis later.

Four lines per decision:

```
## YYYY-MM-DD — <one-line title>
Considered: <the options that were actually on the table>
Chose: <what was picked>
Because: <the reason, in one or two sentences>
```

Record a decision when the choice was not obvious, when you rejected something a reasonable person would have picked, or when future-you will ask "why on earth did we do it this way."

---

## 2026-08-02 — Rebuild rather than refactor v1
Considered: incremental refactor of `mayer-doa-coder/Hisab`; partial rewrite of the sync layer only; full rebuild in a new repository.
Chose: full rebuild in a new repository; v1 archived read-only as `Hisab-v1`.
Because: the problem is scope, not code quality — 45+ schemas, 25+ controllers, ~50 screens, and no test suite for a single-owner shop. Refactoring preserves the scale mismatch that caused the symptoms.

## 2026-08-02 — Money stored as integer poisha with a branded type
Considered: float taka; a decimal library (adds bytes); integer poisha with a branded TypeScript type.
Chose: integer poisha, `type Poisha = number & { __brand: 'Poisha' }`, arithmetic confined to `money.ts`.
Because: eliminates float rounding entirely, costs zero bytes, and the branded type turns unit-mixing into a compile error. v1 mixed `amountCents` on some models with a bare `amount` on `BakiEntry` — a silent 100x error waiting to happen.

## 2026-08-02 — Append-only event log; balances derived, never stored
Considered: mutable entity rows with materialised balances (v1's model); event sourcing with projections; an off-the-shelf CRDT library.
Chose: append-only event log, projections rebuildable from the log, anomalies detected after the fold and surfaced to the shopkeeper.
Because: v1's materialised `Customer.currentDue` / `Supplier.totalOwed` / duplicated `Product.quantity` drifted under offline sync, which is why it needed four conflict token types, three resolution strategies, and three `validate*Consistency` functions. Deriving removes the entire problem class. A CRDT library adds bytes and still does not understand financial invariants.

## 2026-08-02 — No on-device Whisper; voice deferred to closed-vocabulary KWS in Phase 6
Considered: ONNX Whisper-tiny on-device; cloud ASR proxied through our backend; closed-vocabulary keyword spotting; no voice at all.
Chose: closed-vocabulary keyword spotting (~40 words, TFLite, target under 2 MB), deferred to Phase 6.
Because: Whisper-tiny INT8 is 40-75 MB on disk plus 10-20 MB of ONNX Runtime, and peaks at roughly 200-500 MB resident during inference. On a 2 GB device with ~600-900 MB available to a foreground app, that gets the app killed mid-transaction. The vocabulary is closed anyway (v1 already used grammar-constrained decoding), so a general model was always overkill.

## 2026-08-02 — Stay on React Native, with a hard 25 MB APK gate
Considered: React Native / Expo; native Android (Kotlin); Flutter.
Chose: React Native / Expo, with the domain layer as pure TypeScript importing nothing from the platform.
Because: a shared TypeScript domain package between app and server structurally eliminates the trust-engine duplication v1 had in two places, which is worth more to a two-person team than the 10-15 MB Kotlin would save. The zero-I/O domain rule keeps a future Kotlin port a mechanical translation rather than a rewrite. Revisit after Phase 4 if the size gate or measured performance on real low-end hardware fails.

## 2026-08-02 — Requirement 7 scoped to within-shop only
Considered: within-shop aging report; cross-shop shared defaulter registry; cross-shop with zero-knowledge proofs.
Chose: within-shop only for v2; cross-shop documented in the paper as future work, with a harms analysis.
Because: a cross-shop defaulter registry functions as an unlicensed credit bureau operating on data subjects who never consented, with no dispute or appeals mechanism, targeting a population for whom informal credit is often the only credit. The within-shop aging report delivers roughly 90% of the user value at a small fraction of the risk.

## 2026-08-02 — PostgreSQL on the server, not MongoDB
Considered: MongoDB with Mongoose (v1's choice); PostgreSQL.
Chose: PostgreSQL.
Because: the data is relational and requires invariants. Mongoose enforces none at the storage layer, so v1 had to reimplement every invariant in application code on two runtimes and keep them in sync — which is what `semanticValidator.js` and `semanticCRDT.js` in the v1 plan were for. SQL is also far better than aggregation pipelines for the reporting queries the paper needs.

## 2026-08-02 — Reporting MASE and RMSSE, never MAPE
Considered: MAPE (v1's research plan specified MAPE targets throughout); MASE; RMSSE.
Chose: MASE and RMSSE.
Because: shop-level SKU demand is intermittent — zero sales on most days. MAPE is undefined when the actual is zero and unstable near zero, so MAPE targets on this data are meaningless.

## 2026-08-02 — No prototype patching for fonts or localisation
Considered: v1's global patch of `Text.render` / `TextInput.render` / `Alert.alert`; a typed design-system wrapper with explicit `t()` calls.
Chose: design-system wrapper plus explicit `t()`.
Because: the patch ran a translation lookup on every string in every render pass, broke `React.memo`, made components untestable in isolation, depended on a non-public RN API, and could silently corrupt user-entered data when a customer or product name matched a translation key.

## 2026-08-02 — Branch protection turns on after the constitution commit, not before
Considered: direct-to-main throughout Phase 0 (no active second collaborator yet); branch+PR from the very first commit; branch+PR starting once package.json exists.
Chose: the constitution bundle (AGENTS.md, CLAUDE.md, CONTRIBUTING.md, docs/, .github/) goes directly to main; branch protection is enabled immediately after; every commit from the workspace skeleton onward — including solo Phase 0 infrastructure work — goes through a branch and a self-merged PR.
Because: at the constitution commit there is no package.json yet, so ci.yml's `npm ci` step cannot succeed on any branch — gating a commit behind a check that structurally cannot pass isn't a safeguard. Once package.json exists, CI can run, and it should gate the merge rather than audit it afterward; this matters especially in Phase 0, which is largely about proving CI catches real violations. Flagged as an unresolved ambiguity during Claude Code orientation (CONTRIBUTING.md previously stated the branch workflow with no stated exception).

## 2026-08-08 — The domain never writes Bengali; `ViewModelFormatter` is the seam
Considered: domain emits finished Bengali strings; viewmodels carry structured reasons and B renders them; domain calls `t()` directly.
Chose: the domain decides *what* to say as a structured `AttentionReason`, and B implements a `ViewModelFormatter` (over `t()` and the numeral-script setting) that the viewmodel builder is given; the viewmodel itself still carries only finished strings.
Because: `CONTRIBUTING.md` §2 requires B to render strings and never decide who is overdue, while `i18n/` is B's directory and the domain has no locale and may not do I/O. Injecting the formatter satisfies both — the domain owns the judgement, B owns the wording, and the viewmodel stays free of `Poisha` and `Date`.

## 2026-08-08 — Viewmodel builders take `now` as an explicit argument
Considered: fold reads the clock; `last_activity_at` stored as a "days ago" number; `now` passed into the viewmodel builder.
Chose: `ViewModelOptions.now`, supplied by the caller at render time.
Because: `fold()` must be deterministic and ESLint blocks `Date.now()` in `packages/domain/` (§3.1), so no elapsed-time field is derivable from the log alone. Making the clock an argument is what lets `daysSinceActivityDisplay` and `needsAttention` exist at all, and it makes them trivially testable at a fixed instant.

## 2026-08-08 — Aging is computed from the device clock, and we accept that
Considered: use `hlc` for aging; wait for server receipt time; use `occurred_at ?? created_at` and document the limitation.
Chose: `occurred_at ?? created_at`, with `BalanceState.last_activity_at` marked untrusted in `types.ts`.
Because: `EVENTS.md` §1 invariant 2 calls `created_at` untrusted and points at server receipt time for anything authoritative — but the app is offline-first and that time does not exist locally, which is the normal state, not the exception. A device whose clock is years off will show nonsense day counts. The alternative is having no aging view until sync ships, and the aging view is the highest-value screen after credit entry.

## 2026-08-08 — `AnyEvent`: a distributed union over the event map
Considered: `Event<EventType>` with casts in the fold; a hand-written union of 15 members; a mapped distributive union derived from `EventPayloads`.
Chose: `type AnyEvent = { [T in EventType]: Event<T> }[EventType]`.
Because: `Event<EventType>` gives `type: EventType` and `payload: <union>` with no correlation between them, so `switch (e.type)` will not narrow the payload and every case in `fold.ts` would need a cast — in the financial core, which is exactly where casts are least acceptable. Deriving it from `EventPayloads` means adding an event type cannot leave the union stale.

## 2026-08-08 — `LedgerState` does not retain the events it folded
Considered: `LedgerState.entries: AnyEvent[]` so `detectAnomalies(state)` can cite candidates; a windowed slice inside the state; passing the slice to `detectAnomalies` separately.
Chose: `detectAnomalies(state, events)` — the state holds projections only.
Because: anomalies need candidate events to show side by side, but a state object that carries the log invites loading the whole thing into the heap, which is v1's `AppDataContext` bug (§4.2) reappearing in the domain layer. Making the slice an argument puts the memory decision at the call site, where the `LIMIT` already lives.

## 2026-08-08 — `ENTRY_VOIDED` targets any event, not only entries
Considered: leave it scoped to `CREDIT_GIVEN` / `PAYMENT_RECEIVED`; add a `CUSTOMER_UNARCHIVED` event; widen `voids_event_id` to any event id.
Chose: widen it, and say so in `EVENTS.md` §3.
Because: as written, an accidental `CUSTOMER_ARCHIVED` — a plausible mis-tap — was permanently irreversible, with no undo event and no intention of adding one. Widening the target costs one word and removes a class of unrecoverable mistake; a new event type would have cost the whole §9 checklist to do the same job worse.

## 2026-08-08 — `earliest_expiry` removed from the `stock` projection
Considered: keep the column and approximate it from the oldest unexpired batch; add a batch reference to `STOCK_SOLD`; drop the column until Phase 4.
Chose: drop it, and record why in `EVENTS.md` §4.
Because: `STOCK_SOLD` carries no link to the batch it drew from, so the fold knows the total on hand but not which batches remain, and cannot tell whether the earliest-expiring one was already sold. The column was therefore not derivable from the events as specified. Adding batch references would fix it and would also cost a tap at the counter, which is a decision to make against real shop data in Phase 4, not now.

## 2026-08-08 — Sync state is exposed as id sets, not projection columns
Considered: `sync_pending` column on every projection row; a separate local table joined at read time; two id sets on `LedgerState`.
Chose: `pendingCustomerIds` / `pendingProductIds` on `LedgerState`, derived from `synced_at === null` on the envelope.
Because: `syncPending` is required on every viewmodel row (`UI_SPEC`: "each row carries its own sync dot") but is device-local and must not replicate (`EVENTS.md` §6). Keeping it out of the projection columns keeps the rebuild test comparing only replicated state, while still letting the fold produce it in one pass.

## 2026-08-08 — §3.2 carve-out for an amount being composed at the keypad
Considered: read §3.2 absolutely and rebuild screens 4 and 5 around a domain-side amount reducer; expose an opaque amount token to the UI; name an explicit exception for in-progress entry.
Chose: while an amount is being entered, B may add and subtract integer poisha in component state — no division, no floats, no formatting.
Because: `UI_SPEC` screen 4's quick chips add ৫০ to a running amount and screen 5 prefills an editable balance. Both are integer arithmetic in a component, so an absolute reading of §3.2 makes the most important screen in the app unbuildable. An amount in progress is not ledgered money; it becomes money when the event is emitted, and the rule resumes there. Naming the exception is safer than leaving a rule everyone quietly breaks.

## 2026-08-08 — Zod deferred to Phase 1; `types.ts` stays the hand-written contract
Considered: add Zod now and infer types from schemas; hand-write types and add Zod schemas in Phase 1; no runtime validation at all.
Chose: `types.ts` stays hand-written as the A↔B contract; Zod schemas land in `events.ts` in Phase 1 and must satisfy these types, checked by `tsc` rather than by review.
Because: Phase 0 is a contract, not runtime code, and adding a dependency requires a measured APK cost (§3.4, `CONTRIBUTING.md` §6) that nobody has measured yet. Inferring the contract from schemas would also make the jointly-owned file a by-product of A's validation code, when it is meant to be the thing both people read and agree on.

## 2026-08-08 — `Days`, `Quantity` and `EpochMs` brands deferred to Phase 1
Considered: add a `units.ts` now alongside `types.ts`; extend `money.ts`; defer until `money.ts` is written properly in Phase 1.
Chose: defer; `quantity_units`, `delta_units`, `lead_time_days` and every timestamp stay `number` for now.
Because: `AGENTS.md` §6 says any value with a unit gets a brand, and `lead_time_days` in particular is an unbranded orphan. But `BUILD_PLAN.md` puts `money.ts` in Phase 1, the branded values are all Phase 4–5 fields that nothing reads yet, and introducing a second brand file in Phase 0 would mean editing the jointly-owned contract twice. Revisit when `money.ts` is written.

## 2026-08-08 — Empty-app APK baseline: 20.08 MB of the 25 MB budget
Considered: nothing to choose here — this is the Phase 0 exit-criterion measurement, recorded so every later size decision has a floor to compare against.
Chose: record **20.08 MB (21,051,990 bytes)**, arm64-v8a release, measured by `npm run size:check` on `apps/mobile/android/app/build/outputs/apk/release/app-arm64-v8a-release.apk`, built 2026-08-04 from the default Expo template (`App.tsx` unmodified; dependencies `expo`, `expo-status-bar`, `react`, `react-native` only).
Because: the 25 MB per-ABI gate is meaningless without knowing what an empty app already costs. **Roughly 4.9 MB of headroom exists for the entire product** — the design system, six screens, SQLite, sync, i18n, and eventually a sub-2 MB voice model. That is tighter than it sounds and is the reason §3.4 requires a measured byte cost before any dependency is added. Re-measure and append a new entry whenever the Expo or React Native major version changes.

---

## Template — copy this for new entries

## 2026-08-09 — zod added as a real dependency of packages/domain
Considered: hand-roll validation functions instead (no new dependency); declare zod properly as a devDependency-only tool (wrong — it validates on-device at write time per EVENTS.md §1 invariant 6, so it ships in the mobile bundle, not dev-only); declare it as a real dependency with a measured cost.
Chose: declared in `packages/domain/package.json` as `"zod": "^3.25.76"` — the version already resolved in the lockfile, previously present only by accident as a transitive dependency of Expo's own CLI tooling (`expo-internal`), not usable as a real dependency of this project until declared explicitly.
Because: `docs/DECISIONS.md`'s 2026-08-08 entry had already settled that Zod schemas land in `events.ts` in Phase 1 — what was still open was the mechanics of depending on it honestly. Measured via `esbuild --bundle --minify` over a representative slice of real usage (a handful of object schemas, an enum, a discriminated union — not the whole library): **~60KB minified, ~14KB gzipped**. This is an estimate from a bundler+minifier run, not an actual compiled-APK before/after diff (that would need a full native build and wiring zod into `apps/mobile`, both out of scope for this step) — `[VERIFY]` against a real `size:check` diff once `apps/mobile` actually imports the domain package. Against the 20.08 MB empty-app baseline (2026-08-08 entry) with ~4.9 MB of headroom, ~14KB gzipped is a small fraction of the budget and not a blocker, but the real number should be confirmed once there's something in `apps/mobile` to measure against.

## 2026-08-09 — Anek Bangla Regular + Bold added; measured APK cost is 257 KB, not the raw 500 KB
Considered: `@expo-google-fonts/anek-bangla`'s root import (pulls in all 8 weights via its `index.js`'s unconditional re-exports); vendoring raw `.ttf` files manually from Google's variable-font source; deep-importing only the two needed weight submodules (`@expo-google-fonts/anek-bangla/400Regular`, `.../700Bold`) — the pattern the package's own README documents for exactly this reason.
Chose: deep imports of the two weight submodules only, plus `expo-font` for loading. Verified via `npx expo export --platform android` that exactly two font assets are bundled (`AnekBangla_400Regular.ttf` 249 KB, `AnekBangla_700Bold.ttf` 251 KB — not the other six weights), then via a real `npm run build:apk` + `npm run size:check`: **21,315,398 bytes (20.33 MB), a delta of 263,408 bytes (257 KB) over the 2026-08-08 baseline of 21,051,990 bytes (20.08 MB)**. Remaining headroom to the 25 MB budget: **4.67 MB** (down from 4.92 MB).
Because: Google's own source for Anek Bangla ships only a variable font (`wdth,wght` axes in one file), impractical for RN's per-weight `fontFamily` model and this project's own emphasis on older-Android text rendering (AGENTS.md §6: "Test... on Android 8, 9, and 10"); the `@expo-google-fonts` package pre-extracts static instances, which is what's actually needed. The measured 257 KB APK delta is about half the 500 KB raw combined `.ttf` size — the APK's ZIP container compresses the font data — so the raw file size alone would have overstated the real cost. `AGENTS.md` §3.4 requires a measured, not guessed, dependency cost; this is that measurement, done via the actual build pipeline rather than a proxy.

## 2026-08-10 — packages/domain gains a real `main` entry and a `build` script
Considered: leave `main: "src/index.ts"` as-is (worked for `tsc --noEmit` and would work for Metro, which transpiles TS on the fly); commit a built `dist/` to git; add a proper `build` script producing `dist/src/*.js` + `.d.ts` and point `main` there.
Chose: `main: "dist/src/index.js"`, plus `tsconfig.build.json` (declarations on, unlike the existing test-only compile) and a `build` script. `apps/mobile`'s `pretypecheck`/`pretest` hooks run it first.
Because: `apps/mobile/src/data/eventStore.ts` is the first thing that ever imports `@hisab/domain` at actual runtime (everything before this was type-only or `packages/domain`'s own `tsc --noEmit`). Verified directly that `import('@hisab/domain')` failed outright — `ERR_MODULE_NOT_FOUND`, on Node 20 and Node 24 alike, for related but distinct reasons — before this fix. `dist/` stays gitignored; nothing is committed built. Real, if currently low, risk: nothing in the real Metro-bundled app imports `@hisab/domain` yet (screens are Step 8), so Metro's own resolution behavior against the new `main` is unverified — re-check when Step 8 wires this in.

## 2026-08-10 — sql.js, not better-sqlite3, for testing the SQLite data layer
Considered: `better-sqlite3` (native, synchronous, well-established); `sql.js` (SQLite compiled to WASM, no native compilation); no unit tests for the data layer at all, real-device testing only; Jest + `jest-expo`.
Chose: `sql.js`, devDependency only, behind the same `Database` interface `db.expo.ts` implements for the real app.
Because: `better-sqlite3` was tried first and **failed to install** in this environment — no prebuilt binary matched Windows/Node 24, and there is no C++ toolchain here to compile it from source. That is a real, reproduced failure, not a hypothetical risk. `sql.js` needs no native compilation on any platform. `expo-sqlite` itself has no official Node/Jest testing story (checked directly against its own docs) — this is the closest available approximation of real SQLite behavior without a device.

## 2026-08-10 — Two real bugs found and fixed during a whole-project audit
Considered (nextSeq): a lazily-cached `if (cached === null) { cached = await read() }` for the per-device seq counter, vs. a promise-chain queue.
Chose: a promise-chain queue (`seqChain = seqChain.then(c => c + 1)`), so every call to `nextSeq()` — concurrent or not — is serialized through one resolution order.
Because: reproduced directly — two `append()` calls launched before the first's DB read resolved (e.g. a rapid double-tap on the credit-entry button, the highest-frequency action in the app) both read the same `MAX(seq)` and returned the same value, which would collide on `UNIQUE(device_id, seq)`. A regression test now covers this (`eventStore.test.ts`, "concurrent append() calls...").

Considered (HLC bootstrap): leave `Clock` constructed fresh (`ZERO_HLC_STATE`) on every app start, relying on `l' = max(l, physicalNow())` to self-correct; add a `createDeviceClock(db, deviceId)` that seeds from this device's own last-written `hlc`.
Chose: `createDeviceClock`, querying `MAX(hlc) WHERE device_id = ?` before constructing the `Clock`.
Because: `Clock`'s constructor has always accepted an `initialState` parameter for exactly this, but nothing ever called it with a real value — every fresh `Clock` silently started at zero regardless of prior history. If a device's physical clock ever runs behind where it was in an earlier session (clock correction, unreliable RTC), a from-zero restart could produce an `hlc` lower than one this same device already wrote, breaking the monotonicity `fold.ts`'s `(hlc, device_id)` sort depends on. Covered by a new test asserting the bootstrapped clock's next tick sorts after a planted future `hlc`.

## 2026-08-15 — Release build config made durable via expo-build-properties; APK is 22.27 MB, headroom now 2.73 MB
Considered: hand-edit the generated `android/` files again for Hermes/R8/shrinkResources/per-ABI restriction (what was apparently done previously — fragile, and confirmed lost the moment `expo prebuild --clean` ran to pick up this step's three new native dependencies); leave the settings lost and accept a universal, unrestricted APK; add `expo-build-properties` as a config plugin so the settings survive every future regeneration.
Chose: `expo-build-properties`, configured in `app.json`: `enableMinifyInReleaseBuilds`, `enableShrinkResourcesInReleaseBuilds`, `buildArchs: ["arm64-v8a"]`. Verified directly, not assumed: unzipped the resulting `app-release.apk` and confirmed `lib/` contains only `arm64-v8a` — the output is no longer named per-ABI (Gradle's `splits` mechanism isn't what's restricting it), so `scripts/size-check.js` and `size-gate.yml`'s filename glob were both updated from `*arm64-v8a*release*.apk` to `*release*.apk` accordingly.
Because: regenerating `android/` was required to autolink Step 9's three new native modules (`expo-sqlite`, `expo-secure-store`, `expo-crypto`) — `expo prebuild` had never been run since those were added, so the gitignored, locally-generated `android/` project was silently stale relative to `package.json`. `--clean` prebuild wiped settings that had only ever existed as hand-edits to generated files, with nothing durable behind them. Real APK cost of this step, measured on a fresh build: **22.27 MB (23,355,983 bytes)**, up from the 2026-08-09 baseline of 20.33 MB — a **1.94 MB delta**, mostly the three native modules' compiled code (`expo-sqlite` bundles a real SQLite native library). **Remaining headroom: 2.73 MB** of the 25 MB budget, down from 4.67 MB. Nothing in the real app imports this code yet (screens are Step 8) — the native linking cost is already paid regardless, since Expo autolinking works off `package.json`, not JS import graphs.

## 2026-08-15 — build-apk.mjs detects a compatible JDK instead of trusting the environment's JAVA_HOME
Considered: require the developer to fix their own JAVA_HOME manually; hardcode a specific JDK path in the script; have the script detect and select a compatible JDK (17-21) from JAVA_HOME, PATH, or Android Studio's bundled JBR, in that order.
Chose: detection, implemented in `build-apk.mjs`.
Because: reproduced two distinct real failures on this machine in sequence — JAVA_HOME pointed at JDK 11 (Gradle requires 17+); PATH's `java` resolved to JDK 25 (new enough for Gradle, but failed a native CMake configure step with "A restricted method in java.lang.System has been called" — Java 25 is too new for this AGP/NDK toolchain, which is validated against 17-21). Android Studio's bundled JBR (JDK 21) worked. Hardcoding that exact path would only work on this one machine; the detection approach is portable and explains itself when it falls back.

## YYYY-MM-DD — <title>
Considered:
Chose:
Because:
