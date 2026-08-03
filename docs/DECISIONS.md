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

---

## Template — copy this for new entries

## YYYY-MM-DD — <title>
Considered:
Chose:
Because:
