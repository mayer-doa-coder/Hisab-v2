# Hisab v2 — Rebuild Blueprint and Research Strategy

**Prepared:** 2 August 2026
**Basis:** Full read of `README.md` and `PRODUCTION_AND_RESEARCH_PLAN.md` from `github.com/mayer-doa-coder/Hisab` (52 commits, `main`), plus a literature search across Bengali ASR, code-mixed Bangla NLP, ICTD/HCI for micro-entrepreneurs, offline-first sync, micro-credit scoring, Bangla OCR, and intermittent-demand forecasting.

**What this document is:** an audit of what went wrong, a from-scratch build order, a paper strategy, and a UX specification. Every criticism below points at something I actually read in your repo, not a generic best practice.

**A note on honesty:** where I don't know something, I say so. Where a claim in your existing docs looks wrong, I flag it rather than repeat it. There are eight open questions at the end that I need answered before parts of this plan can be made concrete — I have not guessed at them.

---

## Part 0 — Executive summary

Your instinct is right: the project needs a restart, not a refactor. But the reason is probably not the one you think.

The problem is not that the code is messy. The problem is that **the system was designed at a scale that has no relationship to the problem being solved.** You have 45+ Mongoose schemas, 25+ controllers, 100+ SQLite query functions, ~80 context functions, roughly 50 screens, a four-role RBAC matrix, a champion/challenger ML deployment with eight production guardrails and automatic canary rollback, an 11-state voice FSM, USSD payment codes, cross-shop global identity, and a planned zero-knowledge proof protocol — for a shop where one person sells rice and cooking oil and writes names in a notebook.

That mismatch is the root cause of every symptom you listed. The features feel disorganized because there is no organizing principle. The UX is unstructured because there are too many screens to give any of them attention. The bugs are everywhere because the surface area is enormous and there is no test suite mentioned anywhere in the README. The project structure is hard to understand because it encodes a system nobody has fully modeled.

**The single most important decision you will make in v2 is what to leave out.**

The second most important: your requirements list contains three items that are in direct physical conflict with each other, and one item that carries serious ethical and legal risk. Both are addressed in Part 2. You need to resolve them before you write a line of code.

---

## Part 1 — Audit of the current repository

I am listing these because "there are various kinds of bug" is not actionable, but each of these is. These are inferred from the README's own description of the system; some may be inaccurate if the README has drifted from the code — flag any that are.

### 1.1 Correctness and data-model defects

**Money is represented inconsistently.** The README shows `amountCents` on `Transaction`, `Expense`, `CashbookEntry`, and `priceCents`/`costPriceCents` on `Product` and `InventoryBatch` — but plain `amount` and `paidAmount` on `BakiEntry`, and `dueAmount`/`promisedAmount` on `CollectionReminder`/`PaymentPromise`. In a financial application, a mixed integer-minor-unit and ambiguous-unit representation is a guaranteed source of silent 100× errors. It is also unclear whether "cents" means poisha; BDT's minor unit is poisha, and poisha are functionally obsolete in cash retail, so the abstraction may be adding risk for no benefit.

**Stock quantity is stored in two places.** `Product.quantity` and `InventoryBatch.quantity` both exist. The sum of batches and the cached product quantity will diverge. You know this already — the database layer has `validateInventoryBatchConsistency`, `validateSalesMovementConsistency`, and `validatePurchaseMovementConsistency`. Those functions exist because the schema permits states that should be unrepresentable. Same problem with `expiryDate` appearing on both `Product` and `InventoryBatch`.

**Balances are stored, not derived.** `Customer.currentDue`, `Customer.totalPaid`, and `Supplier.totalOwed` are materialized fields. In an offline-first system where two devices can both record a payment, materialized balances are the hardest possible thing to converge. This is precisely why your sync layer needs four conflict token types and three resolution strategies — the complexity is downstream of storing what should be computed.

**MongoDB is a poor fit for a ledger.** Your data is relational (customer → baki entries → payments; product → batches → movements → sale lines) and requires invariants (a payment cannot exceed a balance; stock cannot go negative). Mongoose gives you none of that at the storage layer, so every invariant has to be re-implemented in application code, on two runtimes, and kept in sync. Your own plan document proposes writing a `semanticValidator.js` and a `semanticCRDT.js` to add back what a relational database with `CHECK` constraints and transactions provides natively.

### 1.2 Performance defects — these directly break requirements 4 and 5

**The global prototype patch is the biggest single problem in the codebase.** From the README: `App.js` overrides `render` on React Native's `Text` and `TextInput` at module load, injecting the font and **auto-translating string children across the entire component tree**. `Alert.alert` is patched the same way.

This causes, at minimum:
- A translation function call on every string in every render pass of every component in the app. On a low-end device this is a measurable frame-budget cost on every list scroll.
- Broken memoization: `React.memo` and `PureComponent` optimizations can't reason about a patched render.
- **Data corruption risk.** If the patch translates arbitrary string children, it will translate user-entered data — a customer named "Bill" or a product called "Good Knight" is at risk of being mangled by a translation map. Any bug report of the form "the customer's name changed by itself" traces here.
- Fragility across RN upgrades: `Text.render` is not a public API. RN 0.81 → 0.82 can break it silently.
- Untestability: you cannot unit-test a component in isolation when a module-scope side effect rewrites the renderer.

This must not survive into v2. Localization belongs in explicit `t()` calls or a typed component wrapper, never a monkey patch.

**One context holds everything.** `MainDataShell` "loads all entity data" into `AppDataContext`, which exposes ~80 memoized functions. Every consumer of that context re-renders when any part of it changes. Loading all products, customers, baki entries, alerts, and movements into JS memory at boot also puts your heap in direct conflict with requirement 5. A shop with 800 SKUs and 300 customers and two years of history cannot do this on a 2 GB device.

**Five font weights load at boot.** Anek Bangla 400/500/600/700/800 are five separate font files fetched and parsed before the first frame. Bengali fonts with full conjunct coverage are not small. This is pure cold-start cost.

**On-device ONNX Whisper contradicts the small-app-size requirement.** `onnxruntime-react-native` plus even a tiny/quantized Whisper checkpoint is a large addition to the APK, and Whisper's Bengali performance is not strong to begin with. See §2.1 — this is one of the three-way conflicts you must resolve.

### 1.3 Security defects — these directly break requirement 12

Your `PRODUCTION_AND_RESEARCH_PLAN.md` already identifies five of these well (plaintext SQLite, refresh token theft, USSD brute force, client-computed trust features, sync mass-poisoning). That analysis is sound and I won't repeat it. Here are ones it does not cover:

**`EXPO_PUBLIC_ASSEMBLYAI_KEY` is a leaked credential.** Any environment variable prefixed `EXPO_PUBLIC_` is inlined into the JavaScript bundle. Anyone who downloads the APK and unzips it has your AssemblyAI key. Third-party API keys must live server-side; the client calls your backend, your backend calls AssemblyAI. Rotate that key now if it is a real one.

**Speaking a PIN aloud is a design flaw, not a threshold problem.** The voice FSM has a `WAIT_PIN` state with a confidence threshold of 1.00. Confidence 1.00 protects against mis-transcription. It does not protect against the customer standing eighteen inches away hearing the shopkeeper say their PIN. Voice authentication of a secret in a public retail environment should be removed, not tuned.

**`globalIdentity/verify-otp` is described as "console-log only in current build."** That is a shipped authentication bypass on the endpoint that gates cross-shop identity. Either the endpoint or the feature should not be in `main`.

**The trust engine is implemented twice.** `customerRiskEngine.js`, `trustChampionModel.js`, `trustChallengerModel.js`, `trustGating.js`, `trustExplainability.js`, `trustFallbackPolicy.js`, `trustMonitoringEngine.js`, and `trustRolloutControl.js` exist under *both* `backend/services/trust/` and `frontend/hisab-app/services/customers/`. Two implementations of the same scoring logic in two languages of the same language will drift. When they drift, the client and server disagree about whether a customer is high-risk, and there is no ground truth. Pick one location.

### 1.4 Process and scope defects

**No test suite is mentioned anywhere.** The README documents 100+ database functions, 25+ controllers, a state machine, and an ML ensemble, and never mentions a single test. For a financial application this is the most important missing artifact. A ledger that is 99% correct is worthless.

**ML infrastructure vastly exceeds available data.** A champion/challenger canary at 5% traffic, promoted on eight guardrails including Brier score, PSI drift, calibration shift, and ranking AUC — evaluated across what your plan says is five pilot shops. You cannot obtain statistical power for a PSI drift test at 5% of the traffic of five shops. This machinery cannot do its job at this scale; it is cost with no benefit. Delete it and score customers with a transparent rule until you have thousands of repayment outcomes.

**`BullMQ` is listed as "scaffolded, not yet active."** Dependencies that do nothing are pure weight.

**Repository topics say `firebase` and `python`** while the stack is Node/Mongo/React Native. Small thing, but it is evidence of exactly the drift you're describing.

### 1.5 Two claims in your research plan that I could not verify

I want to be direct about these because you are planning to publish.

**The figure "670 million informal retail transactions occur daily in South and Southeast Asia"** appears in your draft abstract with no citation. I could not find a source for it. An uncited quantitative claim in the first sentence of an abstract is the kind of thing that draws reviewer scrutiny and, if it turns out to be fabricated, is a research-integrity problem. Either find and cite the source or remove the number.

**snarkjs does not implement Bulletproofs.** Your plan states the ZK-Baki feasibility rests on "published implementations of Bulletproofs (snarkjs v0.7+)". snarkjs implements Groth16, PLONK, and FFLONK — pairing-based SNARKs with a structured reference string, which is the opposite of the "no trusted setup" property you cite as the reason for choosing Bulletproofs. The plan also proposes Poseidon-hashed Merkle membership inside the proof, which is a circuit construction typical of SNARKs, not of range-proof Bulletproofs. The feasibility assessment for Innovation B is therefore not grounded. This does not mean ZK credit proofs are impossible — it means the specific toolchain claim is wrong and would not survive review at a venue like CCS.

More broadly: your plan proposes three simultaneous novel contributions, each of which is a full dissertation chapter, on a 24-week timeline, alongside closing seven production gaps. That is not achievable. Part 3 proposes what to do instead.

---

## Part 2 — Resolve the requirement conflicts before you build

You gave thirteen requirements. Three of them cannot all be true at once, and one carries risk you should decide about consciously.

### 2.1 CONFLICT: on-device voice + smallest possible app + low-end devices

You cannot have all three. Pick two.

| Path | App size (rough) | Works offline | Bengali accuracy | Cost |
|---|---|---|---|---|
| **A. On-device neural ASR** (ONNX Whisper/wav2vec2) | Large — model alone typically tens of MB even quantized; plus runtime | Yes | Moderate; Bengali is low-resource | Free per use |
| **B. Cloud ASR** (via *your* backend, never a client-side key) | Small | **No** | Better | Per-minute cost, in BDT, forever |
| **C. On-device keyword-spotting only** — a tiny model recognizing ~40 words (digits, names of intents, "taka", "baki", "jomা") | Small (single-digit MB) | Yes | High *for that closed vocabulary* | Free |
| **D. No voice in v1** | Smallest | — | — | Zero |

**My recommendation: C, and defer even that to Phase 6.** Your README already says the system uses "grammar-constrained ASR decoding" — restricting output to a known command vocabulary. If the vocabulary is closed anyway, a full Whisper model is enormous overkill. A small keyword-spotting or command-word model over a fixed lexicon of digits and ~15 intent words is a fraction of the size, runs on a 2 GB device, and is *more* accurate on that vocabulary than general Whisper. It also happens to be a more interesting and more defensible research contribution than "we ran Whisper."

**Note what you lose:** free-form speech. "Rahim bhai ke pach sho taka baki" will not work as one utterance; you'll need the slot-filling FSM you already have. That's an acceptable trade for the size budget.

### 2.2 CONFLICT: React Native + smallest possible app size

Be honest with yourself about what "lowest app size" means as a hard requirement.

- **Expo/React Native**, with Hermes, ProGuard/R8, resource shrinking, and per-ABI APK splits, realistically lands somewhere in the mid-tens of MB for an app of this complexity. The RN runtime and JS bundle have a floor you cannot go under.
- **Native Android (Kotlin)** with Views or a lean Compose setup can be substantially smaller — single-digit to low-tens of MB — because there's no second runtime.
- **Flutter** sits in between and has its own engine floor.

I am not going to tell you to rewrite in Kotlin, because that decision depends on your team's skills and timeline, which I don't know. But I will tell you this: **if requirement 5 is genuinely a hard constraint, React Native is the wrong tool, and you should decide that now rather than after Phase 4.** If requirement 5 actually means "reasonably small and not bloated," React Native is fine and you should stop treating size as a hard constraint.

Actionable middle path if you stay on RN: set a hard APK budget (e.g., 25 MB per-ABI) as a CI gate that fails the build. Every dependency then has to justify itself against a number. This alone would have prevented ONNX Runtime, BullMQ, and five font weights from entering the project.

### 2.3 ETHICS AND LEGAL: requirement 7, "detection of a person who didn't give money back"

This is the highest-risk item in your entire specification and I want to be very clear about it.

There is a large difference between two features that sound similar:

- **(a)** "Show *me*, the shopkeeper, which of *my* customers owe *me* money and are overdue." — This is an aging report. It is uncontroversial, genuinely useful, and should absolutely be built. It's your single highest-value feature.
- **(b)** "Tell shops in the network that this person is a defaulter." — This is a credit bureau. Run by a student project. Without a licence, without a dispute process, without an appeals mechanism, without consent from the data subject, targeting low-income people, on data of unverified accuracy.

Feature (b) is what your `GlobalCustomerIdentity` and cross-shop trust scoring are heading toward. The harms are concrete: a single data-entry error or a dispute over goods quality permanently marks someone as untrustworthy across every shop in their area, cutting off the informal credit that is often the only credit they have. There is no mechanism in the design for the customer to see, contest, or correct their score. The customer is not a user of your app and has consented to nothing.

There is also a legal dimension I cannot resolve for you: **Bangladesh's data protection regime has been in flux, and I do not have reliable current information on the status of the Personal Data Protection Ordinance/Act as of August 2026.** Independently of that, note that you are proposing to store the name, phone number, address, photograph, and financial history of a third party who never installed your app. You must check:
- The current status and text of Bangladesh's data protection law
- Bangladesh Bank's regulatory perimeter for anything resembling credit information sharing, and the remit of the Credit Information Bureau
- Whether photographing a customer as "photo proof" for a debt (your `CustomerPhotoCapture` component) is lawful and, separately, whether it's something you want to build

**My recommendation:** build (a), which is 90% of the user value at 5% of the risk. Explicitly descope (b) from v2. If you later want cross-shop trust, that is a *research* question to write about — including the harms — not a feature to ship to shopkeepers.

This also matters for publication. Venues like ACM COMPASS, ICTD, and CHI have ethics review, and a paper that proposes a cross-shop defaulter registry without an ethics analysis, informed consent from data subjects, and a harms discussion will be rejected. Conversely, a paper that *does* engage seriously with this tension is much more publishable than one that doesn't, because that tension is the interesting part.

### 2.4 CLARIFY: requirement 6, "security of public information"

I don't know what you mean by this and I won't guess. Possible readings:
- Protecting customer PII (names, phones) held on the device
- Protecting shop financial data from other shops
- Protecting data from someone who steals the phone
- Something about public/shared APIs

Tell me which and I'll write the specific controls.

---

## Part 3 — The v2 architecture

### 3.1 The one idea that fixes most of your problems: an append-only ledger

Stop modeling entities with mutable balances. Model **events**, and derive everything else.

```
events (append-only, never UPDATEd, never DELETEd)
├── id             TEXT PRIMARY KEY   -- UUIDv7, generated on-device
├── device_id      TEXT              -- which device created it
├── seq            INTEGER           -- monotonic per device
├── hlc            TEXT              -- hybrid logical clock, for ordering
├── shop_id        TEXT
├── type           TEXT              -- CREDIT_GIVEN | PAYMENT_RECEIVED | SALE | ...
├── payload        TEXT              -- JSON, validated by a versioned schema
├── created_at     INTEGER           -- device wall clock (untrusted, for display)
└── synced_at      INTEGER NULL      -- NULL = not yet pushed
```

Everything else in the local database is a **projection**: a derived table you can drop and rebuild by replaying the log.

Why this solves your specific problems:

| Problem in v1 | How the event log fixes it |
|---|---|
| Four conflict token types, three resolution strategies | Two devices appending different events is not a conflict. Union the logs, sort by HLC, fold. Convergence is automatic for the 95% case. |
| `Customer.currentDue` drifting between client and server | It doesn't exist. Balance = fold over that customer's events. Client and server run the same fold and get the same number by construction. |
| `validateInventoryBatchConsistency` etc. | Nothing to validate. Stock = fold over movement events. |
| Audit log as a separate system | The log *is* the audit trail. |
| "Who edited this and when" | An edit is a `CORRECTION` event referencing the original. Nothing is ever destroyed. |
| Backup/restore | Copy the log. That's the whole backup. |
| Sync bandwidth | Send events after your last-acked `seq`. Immutable, so no diffing, no delta encoder needed. |

Where it doesn't help, and you must handle explicitly: **genuine semantic conflicts.** Two devices offline both record a ৳500 payment against a ৳500 balance. Both events are valid; together they overpay. The fold produces a negative balance.

The v1 plan's answer was FS-CRDT with invariant escalation. That's the right *shape* of answer. But the simple version is: **let the balance go negative, detect it during the fold, and surface it as a review item.** No new framework needed:

```js
// Reconciliation runs after every fold. It does not block writes.
function detectAnomalies(customerId, events) {
  const balance = fold(events);
  if (balance < 0) {
    return {
      kind: 'OVERPAYMENT',
      customerId,
      amount: -balance,
      candidates: events.filter(e => e.type === 'PAYMENT_RECEIVED')
                        .slice(-3),   // likely duplicates
    };
  }
  return null;
}
```

The shopkeeper sees: *"রহিম ভাই — ৫০০ টাকা দুইবার জমা হয়েছে বলে মনে হচ্ছে। ঠিক আছে?"* with the two entries side by side and one tap to void one. This is better UX than automatic resolution, because a human in the shop knows what actually happened and the algorithm doesn't.

**Constraint you must honour:** events must be small, self-contained, and their schema versioned from event #1. Write a `schema_version` into every payload on day one. You will thank yourself.

### 3.2 Money

One rule, no exceptions: **money is a 64-bit integer count of poisha (1 BDT = 100 poisha), stored as `INTEGER`, named with a `_poisha` suffix, and never touched by a floating-point operation.**

```js
// utils/money.js — the ONLY module that knows what money is
export const fromTaka = (taka) => Math.round(taka * 100);          // input boundary
export const toTakaString = (poisha) => (poisha / 100).toFixed(2); // display boundary only
export const add = (a, b) => a + b;
export const splitEvenly = (poisha, n) => { /* distribute remainder deterministically */ };
```

Add a lint rule that bans arithmetic on any identifier ending in `_poisha` outside this module. This one discipline eliminates an entire bug class.

### 3.3 Layer boundaries

```
┌───────────────────────────────────────────────────────────┐
│  UI  — screens and components                             │
│  Rule: knows nothing about SQL, HTTP, or event types.     │
│  Reads view-models. Emits intents.                        │
├───────────────────────────────────────────────────────────┤
│  DOMAIN  — pure functions, zero I/O, 100% unit tested     │
│  fold(events) → balance                                   │
│  applyPayment(state, cmd) → Event[] | DomainError         │
│  reorderPoint(history, leadTime, service) → qty           │
│  Rule: no imports from react, expo, sqlite, or fetch.     │
├───────────────────────────────────────────────────────────┤
│  DATA  — event store + projections (SQLite)               │
│  append(event), since(seq), rebuildProjections()          │
├───────────────────────────────────────────────────────────┤
│  SYNC  — push unsynced events, pull remote events         │
│  Rule: the only module that knows the network exists.     │
└───────────────────────────────────────────────────────────┘
```

The rule that matters most is the domain layer having **no I/O**. It makes the financial logic testable in milliseconds without a device, a database, or a network. If you take one structural idea from this document, take that one. Your v1 has no such layer — financial logic is spread across `db.js` (100+ functions), `AppDataContext` (~80 functions), controllers, and services, which is why nothing is testable and why the same logic is duplicated on client and server.

With this boundary, the client and server **share the domain layer as a single package**. The trust-engine duplication problem disappears structurally.

### 3.4 Server

Keep it small. The server's jobs are: authenticate, accept events, store events, return events, and run anything too heavy for a phone.

**Use PostgreSQL, not MongoDB.** Reasons specific to you: your data is relational; you need transactions across the event table and projections; you want `CHECK` constraints and foreign keys enforcing invariants at the storage layer rather than in duplicated application code; and SQL is far better than aggregation pipelines for the reporting queries you'll want for the paper. If your team only knows Mongo and the timeline is tight, Mongo with a strict single-collection event store is survivable — but you will be re-implementing constraint checking by hand, which is what your v1 plan is already doing.

**Endpoint count target: under 12 for v1.**

```
POST /v1/auth/login
POST /v1/auth/refresh
POST /v1/auth/logout
GET  /v1/events?since={seq}      ← pull
POST /v1/events                  ← push (batch, idempotent by event id)
GET  /v1/health
```

Note that idempotency is free here: event IDs are UUIDs generated on the device, so `INSERT ... ON CONFLICT (id) DO NOTHING` makes retries safe with no hash table, no 24-hour TTL, and no `IdempotencyRecord` model.

Compare to v1's ~20 route domains and ~25 controllers. Everything the old endpoints did — reports, ledgers, statements, collections dashboards, trust scores — is a *query over events*, which the client can do locally and offline.

### 3.5 What v1 features get cut, kept, or deferred

**Cut entirely from v2:**

| Feature | Why |
|---|---|
| Champion/challenger canary, 8 guardrails, auto-rollback, PSI drift | No data volume to support it. Replace with a transparent rule (§3.6). |
| Client-side duplicate of the trust engine | Shared domain package instead. |
| Global prototype patching of `Text`/`TextInput`/`Alert` | Correctness and performance hazard. |
| BullMQ | Scaffolded, unused. |
| Four-role RBAC (`OWNER`/`CASHIER`/`STOCK_MANAGER`/`ACCOUNTANT`) | A one-person shop has one role. Start with `OWNER` and `HELPER`. |
| Branches, team users, approval requests, purchase orders, goods receive, cycle count, supplier payables, day close | Multi-branch, multi-staff features for a single-owner shop. Every one is a screen you are maintaining for zero users. |
| Voice `WAIT_PIN` state | Security design flaw (§1.3). |
| `EXPO_PUBLIC_ASSEMBLYAI_KEY` | Leaked credential. Proxy through your backend if you use cloud ASR at all. |
| Cross-shop defaulter sharing | See §2.3. |
| ZK-Baki, FS-CRDT framework, neuro-symbolic forecasting | See Part 4. |

**Keep — these are the actual product:**
Baki entry, payment recording, customer list with amounts owed, aging/overdue view, product list with quantity, low-stock alert, expiry alert, simple sale recording, daily summary, Bangla/English switching, Banglish search, offline operation with background sync.

That is roughly twelve screens. Not fifty.

**Defer to explicit later phases:** voice, reorder suggestion, risk scoring, OCR, USSD/SMS, PDF export, batch/FEFO inventory, multi-user.

### 3.6 Requirements 2, 7, 8: what "AI" should actually mean here

Your requirement 2 asks for AI automation, and 8 asks for stock prediction with small models. Here is the honest engineering answer.

**Start with rules, not models, and be explicit that they're rules.**

For "who hasn't paid" (req 7 — the *within-shop* version):

```js
// Fully transparent, no training data required, explainable in one sentence.
const overdueDays  = daysSince(lastActivity(customer));
const utilisation  = balance(customer) / creditLimit(customer);
const brokenPromises = countBrokenPromises(customer);

const needsAttention =
  overdueDays > customer.termsDays ||
  utilisation > 0.9 ||
  brokenPromises >= 2;
```

Shown to the shopkeeper as *"৪৫ দিন ধরে কিছু দেননি"* — a fact, not a score. Facts are auditable; a 0.73 risk score is not, and a shopkeeper cannot argue with it.

Only move to a learned model once you have **hundreds of resolved repayment outcomes** (paid vs. written off). Then start with logistic regression, report AUC *and* calibration, and keep the rule as the fallback. Do not start with LightGBM.

For stock prediction (req 8), the literature actually favours small models here — this is real, not a compromise. Shop-level SKU demand is **intermittent**: many days with zero sales, occasional spikes. The established methods for intermittent demand are Croston's method (1972), the Syntetos–Boylan Approximation, and Teunter–Syntetos–Babai, and there is published work using Markov chains for exactly this. A recent line of work proposes a *Markov-combined method* that uses transition probabilities over demand/inventory states to select a forecasting method, and reports better accuracy than SES, SBA, and Croston on large e-commerce datasets.

So the shape of your v2 forecaster:

```
1. Classify each SKU by demand pattern (ADI / CV² — the Syntetos–Boylan–Croston quadrant)
2. Route:
   - Smooth demand      → simple exponential smoothing
   - Intermittent       → Croston / SBA / TSB
   - Lumpy              → Markov state model over (demand state × stock state)
   - Fewer than N obs.  → no forecast; say "not enough data yet"
3. Reorder point = expected lead-time demand + safety stock(service level)
4. Apply a *transparent multiplier* for Eid / Ramadan / monsoon — as an explicit,
   shopkeeper-editable number, not a hidden model weight.
```

All of this is a few hundred lines of arithmetic. It fits in the domain layer, runs in microseconds, adds nothing to app size, and — importantly — **it is the thing your paper can benchmark.** See §4.2 Option D.

That last point about the seasonal multiplier is a UX decision as much as a modelling one: the shopkeeper knows Eid demand better than your model does. Let them set it, show them what it does, and log what they choose. What they choose is *data*, and it's data nobody else has.

---

## Part 4 — Research and publication strategy

### 4.1 The core problem with your current plan

Your plan proposes three novel contributions in cryptography, distributed systems, and neuro-symbolic ML, simultaneously, in 24 weeks, targeting CCS, VLDB, MLSys, and COMPASS.

To calibrate: ACM CCS and VLDB acceptance rates are typically in the mid-to-high teens, and their submissions come from research groups that have worked on a single problem for two or more years. MLSys is similar. Papers at these venues are not accepted for having a good idea; they're accepted for exhaustive evaluation against strong baselines, which requires a mature artifact and often multiple prior attempts.

Meanwhile, the artifact you'd be evaluating has 52 commits, no test suite, a leaked API key, and a stubbed OTP endpoint.

**This is not a criticism of ambition. It is a sequencing problem.** The way to eventually publish at CCS is to publish at ICCIT first, then at a workshop, then at a mid-tier venue, building an artifact and a track record. Trying to skip to the top costs you a year and produces nothing.

### 4.2 Pick exactly one contribution

Here are four options, each of which is genuinely achievable and genuinely publishable. **Choose one.** The right choice depends on your answers to the questions in Part 7.

---

#### Option A — A code-switched Bangla–English transactional command dataset and benchmark

**The gap, and I checked this carefully.** There is now a reasonable body of work on code-mixed Bangla–English resources: TB-OLID for transliterated offensive language, SentMix-3L and EmoMix-3L and OffMix-3L for three-language sentiment/emotion/offense, BnSentMix for sentiment, BanglishRev for e-commerce reviews. There are Bangla ASR resources — Bengali Common Voice, OOD-Speech, RegSpeech12, Bangla-Wave, and dialect work like BanglaDialecto.

What I could **not** find is a dataset for **transactional intent-and-slot understanding in code-switched Bangla–English** — the language a shopkeeper actually uses: *"Rahim bhai ke 500 taka baki dilam"*, *"aaj 3 kg chal becha hoise"*, *"Karim er kach theke 200 joma"*. That is a different linguistic problem from sentiment classification: it needs intent classification plus slot extraction (person, amount, quantity, unit, date), over Bengali *and* Arabic numerals, with Banglish transliteration variation, and with person names that are out-of-vocabulary by construction.

**What you build:** 3,000–5,000 utterances collected from real shopkeepers (crucially — not synthesised by you or an LLM, which reviewers will ask about and which would undermine the contribution). Annotated with intent + slots. Released under CC-BY on Hugging Face. Benchmarked against BanglaBERT, BanglishBERT, mBERT, MuRIL, XLM-R, and a modern multilingual LLM in zero-shot and few-shot settings.

**Why it's strong:** dataset papers are the most reliably publishable kind of first paper. The contribution is unambiguous, the evaluation is standard, the artifact is reusable by others (which drives citations), and it directly serves your requirement 3 and requirement 10.

**Effort:** medium. The hard part is data collection, not modelling — which is good, because data collection is a matter of effort rather than luck.

**Where to send it:** the BLP (Bangla Language Processing) workshop, which has run alongside EMNLP; LREC-COLING; ICCIT; or an NLP-track journal.

---

#### Option B — A deployment field study of digital baki adoption in Dhaka shops

**The gap.** There is substantial work on mobile financial services adoption in Bangladesh — affordance studies, financial-inclusion analyses, a 12-month ADB randomised controlled trial on digital financial service adoption among low-income microentrepreneurs, and HCI work on low-literate users' security practices in the MFS ecosystem. There is also HCI work on micro-entrepreneurs' financial needs in comparable South Asian contexts (e.g., CHI work on Pakistani micro-entrepreneur women).

What is scarce is a longitudinal deployment study of a **digital baki/khata ledger specifically** — what shopkeepers actually do when the notebook becomes an app, what breaks, what they refuse to do, and what the social dynamics of credit look like when they become legible.

**What you build:** deploy to 15–25 shops for 10–16 weeks. Instrument everything (with consent). Combine telemetry with pre/post interviews and observation. Report: what fraction of transactions actually get recorded vs. abandoned mid-flow; whether they keep the paper notebook anyway (they will — the question is why); whether the customer-facing dynamic changes; what the failure modes are.

**Why it's strong:** it is a contribution no amount of engineering skill can substitute for, because it requires field access. It also feeds directly back into your product. And "we built it and shipped it and here is what actually happened" is exactly what ICTD/COMPASS venues want.

**Effort:** high in calendar time, moderate in technical difficulty. **This is the option with the longest lead time — if you're considering it, you must start recruiting shops in the next few weeks, before the app is finished.**

**Where to send it:** ACM COMPASS, ACM ICTD, CHI (hard), or the *Information Technologies & International Development* / *EJISDC* journals.

---

#### Option C — Offline-first financial sync with invariant preservation

This is your FS-CRDT idea, made achievable.

**The honest framing:** CRDTs are well-studied; invariant preservation under concurrency is well-studied (Balegas et al.'s invariant-preserving work, which your plan correctly cites); local-first software is a well-known research programme. Your contribution is not "invariants in CRDTs" — that would not be novel. Your contribution is an *empirical systems* one: **a concrete design and measurement of invariant-preserving replication for financial ledgers on low-end mobile devices under realistic developing-region network conditions.**

**What you build and measure:** a network-partition simulator; N simulated devices with realistic connectivity traces (frequent short disconnects, high latency, asymmetric loss); measured convergence time, anomaly rate, escalation rate, false-escalation rate, battery cost, and sync payload size across 2–3 designs (last-write-wins baseline / your event log with reconciliation / an off-the-shelf CRDT library like Automerge or Yjs). Run it on actual budget Android hardware, not an emulator.

**Why it's strong:** it's fully self-contained. You do not need shop access or annotators. You need a simulator and patience. The evaluation is entirely within your control.

**Effort:** medium-high technically, low logistically.

**Where to send it:** ICCIT, NSysS (Networking, Systems and Security — the Bangladesh-hosted one), or a systems journal. Not VLDB for a first paper.

---

#### Option D — Lightweight intermittent-demand forecasting for Bangladeshi kirana SKUs, on-device

**The gap.** Croston, SBA, and TSB are the standard intermittent-demand baselines; Markov-based methods for intermittent demand exist and have been validated on large Chinese e-commerce datasets. What does not exist, as far as I can find, is an evaluation of these methods on **Bangladeshi small-shop SKU data**, under an **on-device compute and memory budget**, with **South Asian seasonality** (Ramadan and the two Eids moving through the solar year, monsoon, harvest).

**What you build:** collect real daily sales for 100+ SKUs across 10+ shops for as long as you can (this is the binding constraint — start collecting *now*). Benchmark SES, Croston, SBA, TSB, a Markov state model, and EMA. Report MASE and RMSSE (not MAPE — MAPE is undefined and unstable when actuals are zero, which is most days for intermittent demand; this is a mistake in your current plan, which specifies MAPE targets throughout). Also report **model size in KB, inference latency in ms on a real budget phone, and battery cost** — the on-device angle is the differentiator.

**Why it's strong:** it matches requirement 8 exactly, so the research and the product are the same work. The baselines are established, so you're not inventing an evaluation from scratch. And the "does this run on a ৳10,000 phone" framing is genuinely underexplored.

**Effort:** medium. **Data collection is the long pole — start immediately.**

**Where to send it:** ICCIT, an operations-research or forecasting venue, or a journal.

---

### 4.3 My recommendation

**If you are one or two students with roughly a year:** Option A or Option D. Both have a clear artifact, a standard evaluation, and no dependency on things outside your control.

**If you have real shop access already:** Option B, and start recruiting this month. Field access is the scarce resource; if you have it, use it.

**If you are strongest in systems and want zero external dependencies:** Option C.

**Whichever you choose, note that Options A, B, and D all require data collection to start well before the app is finished.** That's the scheduling insight that matters most. Do not build for six months and then start collecting.

### 4.4 Venue ladder

| Tier | Venue | Notes |
|---|---|---|
| **Start here** | **ICCIT** | 29th edition, 18–20 December 2026, Cox's Bazar, organised by IEEE Bangladesh Section. IEEE Xplore indexed. Longest-running IEEE-sponsored peer-reviewed conference in Bangladesh; historically around 31% acceptance, with 1270+ submissions in 2024. **Check iccit.org.bd/2026 for the current submission deadline — I did not verify it and you should not rely on my guess.** |
| Also local | ICISET (IIUC, Chattogram), ICEEICT, NSysS, ICCA | IEEE tracks available; good second options |
| Topic-specific | BLP workshop (Bangla Language Processing, has co-located with EMNLP), LREC-COLING | Best fit for Option A |
| ICTD | ACM COMPASS, ACM ICTD | Best fit for Option B; ethics review required |
| Journal / extended | IEEE Access, Elsevier journals, EJISDC | Extend the conference paper afterwards |

**Two warnings.** First, "conferencealerts"-style aggregator listings for Bangladesh contain a large number of low-quality pay-to-publish events. Verify: is it IEEE- or ACM-sponsored? Is there a named technical programme committee with real affiliations? Are past proceedings actually in IEEE Xplore or the ACM DL? If the site emphasises fees and certificates over review, walk away. A predatory publication is worse than no publication.

Second, **check whether your institution requires ethics/IRB approval, and start that process early.** Options A and B both involve human subjects. Approval can take weeks.

### 4.5 How to read papers, and how to convert them into code

You asked specifically how to search, where to look, and how to apply the work. Here is a concrete protocol.

**Where to search, in priority order**

1. **Google Scholar** — broadest coverage. Use it to find things, then get the authoritative version elsewhere. Use the "Cited by" link aggressively: find one good paper, then read what cites it. That's how you find the recent work.
2. **ACL Anthology** (`aclanthology.org`) — free, complete, and authoritative for all NLP. This is where Option A's related work lives. Search "Bangla", "Bengali", "code-mixed", "transliterated".
3. **arXiv** — preprints. Fast, free, but **not peer reviewed**. Fine to read, risky to build on without checking whether it was ever published.
4. **IEEE Xplore** — where ICCIT and most Bangladeshi conference papers live. Access via your university.
5. **ACM Digital Library** — COMPASS, ICTD, CHI, CSCW.
6. **Semantic Scholar** — best citation-graph tooling; good for "what else does this paper connect to".
7. **Connected Papers** and **Research Rabbit** — visual citation-neighbourhood exploration. Give either one seed paper and you get a map of the subfield in minutes. Extremely efficient for building a related-work section.
8. **Bangladeshi university repositories** — BRAC, BUET, DU, NSU, AIUB, DIU institutional repositories hold theses that never appear in indexed venues. Local context you will not find anywhere else. Also check the ICT Division, a2i, BIGD (BRAC Institute of Governance and Development), and the SME Foundation for grey literature and statistics on Bangladeshi MSMEs — you will need those numbers for your introduction, **with citations**.

**Search-query construction.** Don't search for your product. Search for the *technical problem*. `"Hisab app Bangladesh"` returns nothing useful. `"intermittent demand" Croston retail` and `code-mixed Bangla intent slot filling` and `offline-first replication invariant financial` return the actual literature. Search for method names, dataset names, and problem names.

**The extraction table.** Keep one spreadsheet. One row per paper. Columns:

| Column | What goes in it |
|---|---|
| Citation key | `rakib2023banglawave` |
| Venue + year + type | ICSCA 2023, conference |
| Problem | The problem *they* solved, in one sentence |
| Method | The core technical idea, in two sentences |
| Data | Dataset, size, availability |
| Baselines | What they compared against |
| Metrics + results | The headline number |
| Limitations | **Their own stated limitations** — read the last section |
| Relevance to Hisab | Baseline / method to adopt / related-work-only / gap I can fill |
| Code available? | URL or "no" |

The **Limitations** column is the most valuable one and most people skip it. Authors state their own weaknesses in the final section. Those stated weaknesses are a curated list of open problems. Your contribution very often lives in someone else's limitations paragraph.

**The two-hour reproduction test.** Before you adopt any method, spend two hours trying to run the authors' code (or reimplement the simplest version) on toy data. If you cannot get a baseline running in two hours, either the paper is under-specified or the method is too complex for your timeline. Either way you've learned something cheaply. Do this *before* committing to a method, not after.

**The three-pass read.** Pass 1: title, abstract, figures, conclusion — 5 minutes, decide whether to continue. Pass 2: full read, skipping proofs and derivations — 45 minutes, fill in the extraction table. Pass 3: only for the 3–5 papers you will actually build on — reproduce the equations and the evaluation setup. Most papers stop at pass 1. That is correct and intended.

**Converting a paper into your codebase.** The discipline that matters is: *implement the baseline before you implement the improvement.*

```
1. Reimplement the paper's baseline in your domain layer, as a pure function.
2. Write a test that reproduces the paper's reported number on the paper's dataset.
   If you can't reproduce it, you don't understand the method yet. Stop here.
3. Run the baseline on YOUR data. Record the number. This is now your floor.
4. Only now implement your modification.
5. Compare against the floor, on your data, with the same metric.
6. Anything that doesn't beat the floor gets deleted from the codebase.
```

Step 6 is the one that prevents v1 from happening again. In v1, the ensemble of "logistic regression + Markov posterior + EMA signal, weighted" exists without any evidence that it beats a single one of its components. Every model in v2 must earn its place against a simpler alternative or come out.

**Citation hygiene.** Use Zotero (free) with the browser connector and a BibTeX export into your LaTeX project. Never type a citation by hand. Never cite a paper you have not opened. Reviewers check, and a citation that doesn't say what you claim it says is worse than no citation.

**Track your own claims.** Keep a second sheet: every quantitative claim you plan to make in the paper, and the file/experiment/log that supports it. The "670 million transactions" problem in your current draft is exactly what this prevents.

---

## Part 5 — UX and UI

You asked how to give users the best experience. The answer starts with understanding that this is not a phone app used on a sofa. It's a tool used standing behind a counter with a customer waiting.

### 5.1 The design constraints that actually apply

**The customer is standing there.** Every core action competes with a paper notebook that takes about four seconds. If recording a baki takes longer than that, the shopkeeper reaches for the notebook, and your app is dead. This is the single hardest constraint in the product.

- **Target: credit entry complete in under 8 seconds, five taps maximum.**
- Measure it. Put a timer on the flow in your telemetry. Treat regressions as bugs.

**One hand, one thumb.** The other hand is holding goods, cash, or a bag. All primary actions belong in the lower half of the screen. The top of the screen is for reading only. Your v1 has a bottom tab bar (good) plus a drawer with ~30 items (bad — drawers require a reach or a swipe and hide everything).

**Interruptions are constant.** A customer walks in mid-entry. The app must survive being backgrounded at every step and return exactly where it was. Draft state must persist to disk on every field change, not on submit.

**Screens are bad and hands are dirty.** Assume cracked glass, a scratched screen protector, glare from a shopfront, and imprecise touch. Minimum touch target 48dp, generously spaced. High contrast. Do not rely on subtle colour differences.

**Numbers matter more than words.** The amount is the most important thing on every screen. It should be the largest element. Never truncate it, never let it wrap, never render it in a light font weight.

### 5.2 The core interaction: recording a baki

This is the flow to obsess over. Everything else is secondary.

```
[Home]
   ↓  one large button, bottom of screen, thumb-reachable
[Who?]
   • Big search field, focused, keyboard already open
   • Below it: last 8 customers, most recent first, as large tappable rows
     with photo/initial + nickname + current balance
   • Search matches Bangla, Banglish, AND phone number simultaneously
   • "+ new customer" always visible at the bottom
   ↓
[How much?]
   • Full-screen numeric keypad — NOT a text input with the system keyboard
   • Amount renders huge at the top as it's typed
   • Quick chips: ৫০ ১০০ ২০০ ৫০০ ১০০০ (tap to add, tap again to add again)
   • The confirm button is the bottom-right key of the keypad itself
   ↓
[Done]
   • Immediate. No spinner. The write already happened locally.
   • Shows: name, new total balance, and an UNDO button for 10 seconds
   • Optional one-tap: show this screen to the customer
```

Notes on why each choice:

- **Recent-first, not alphabetical.** Retail follows a strong recency and frequency distribution. The person buying now probably bought last week. Alphabetical ordering is optimised for a filing cabinet, not a shop.
- **Nicknames, not legal names.** Shopkeepers know customers as "Rahim bhai", "chairman shaheb", "the tailor". Make the display name a free-text nickname field and let full name be optional. Your v1's `CustomerForm` requires name, phone, address, credit limit, and due terms — that's five fields to add someone who is standing at the counter. Collapse it to one required field: what you call them.
- **A custom keypad, not the system keyboard.** The system keyboard is small, takes time to appear, and offers a hundred irrelevant keys. A full-screen keypad with digits, a backspace, and a confirm key is faster and impossible to mistype.
- **Undo, not confirm.** A confirmation dialog costs every user a tap forever to prevent a rare error. An undo affordance costs nothing and fixes the error when it happens. This is the right trade for a high-frequency action.
- **Never show a spinner for a local write.** In an offline-first app, the write is already durable. Showing a loading state teaches the user to distrust the app.
- **"Show the customer" matters more than it sounds.** The paper ledger works socially because it is *mutually visible* — the customer watches the number being written. A phone screen faces one way. If the app breaks that mutual visibility, the customer loses trust in the debt record and the shopkeeper loses a social tool. Give them a big, clean, customer-facing view. This is a genuinely under-designed area in existing khata apps and is worth doing well.

### 5.3 Bangla-specific interface concerns

**Numerals: test, don't assume.** Your v1 converts all digits to Bengali script (০-৯) when the locale is `bn`. That is a reasonable default but it is an *assumption*. Many Bangladeshi shopkeepers read Arabic numerals faster than Bengali numerals for money, because prices, currency notes, phone numbers, and calculators all use Arabic numerals. Getting this wrong makes every number on every screen slower to read.

- Make it a setting, defaulted to Arabic numerals for *money* and configurable.
- **Then test it.** Time how long it takes shopkeepers to read amounts in each script. This is a small, clean experiment. It could be a figure in your paper.

**Indian grouping is correct** — 12,34,567 not 1,234,567. Your v1 gets this right. Keep it.

**Typography.** Anek Bangla is a good choice. But:
- Load **two weights, not five.** Regular and Bold. Everything else is achievable with size and colour.
- Bengali needs more line-height than Latin — ascenders, descenders, the matra (headline), and conjuncts (যুক্তাক্ষর) all need vertical room. Under-leading Bengali text is the most common typographic mistake in Bangla apps.
- **Test conjunct rendering on Android 8, 9, and 10.** Bengali text shaping had real bugs on older Android versions. Test strings with heavy conjuncts: ক্ষ, ঞ্জ, স্ত্র, ন্ত্র, দ্ধ, ট্ট.
- Do not centre long Bengali text. Left-align.

**Banglish input is a first-class requirement, not a nicety.** Most shopkeepers do not have a Bangla keyboard installed, or find it slow. Typing "rohim" must find রহিম. Your v1 has `banglishSearch.js`, which is the right idea — but transliteration is many-to-many (রহিম / রহীম / rohim / rahim / rohom) so use phonetic normalisation plus edit distance, not exact mapping. Search should match against Bangla name, Banglish name, and phone number in one pass.

### 5.4 Communicating uncertainty and risk

For anything predicted — stock suggestions, overdue flags:

- **State the fact, not the score.** *"গত ৩০ দিনে ২৫ কেজি বিক্রি হয়েছে"* beats *"Predicted demand: 24.7 ± 6.2 (confidence 0.71)"*.
- **Always show the reason.** Every suggestion needs a one-line "why". Your v1's `ExplainPanel` and `ConfidenceBar` are the right instinct — but a confidence bar is meaningless to a shopkeeper who has no calibration for what 71% means. Replace numeric confidence with plain language: "based on the last 3 months" vs "not much data yet".
- **Say "I don't know."** When a product has 5 days of history, the correct output is *"তথ্য কম — আরও কিছুদিন লাগবে"*, not a forecast. Fabricated confidence destroys trust permanently, and trust is the only reason this app gets used.
- **Never render a risk score where a customer can see it.** A customer glancing at the counter phone and seeing themselves labelled "HIGH RISK" in red is a social harm you created. Use neutral, factual framing on any screen that might be visible: "৪৫ দিন", not "উচ্চ ঝুঁকি".

### 5.5 Offline and sync, from the user's point of view

- **Do not show an "offline" banner.** Offline is the normal state, not an error. A permanent warning banner trains users to ignore warnings.
- Show sync state **subtly and only when it matters**: a small indicator with the last-sync time, and a clear signal only when something has failed repeatedly for a long time.
- Every entry shows its own sync state in the row (a tiny dot: pending / synced), so the user can see that nothing is lost.
- The one thing that *must* be loud: **"you have unsynced data and you're about to log out / uninstall."**

### 5.6 Onboarding

- **Nothing before first value.** The first screen should let them record a baki. Account creation can come after they've seen it work. Your v1 requires signup → email verification → PIN setup before the app is usable. Email verification is a particularly bad gate: many target users don't use email meaningfully.
- **Phone number, not email**, as the primary identifier — that's the identifier this population actually has and uses.
- Seed nothing. Let them add their first three customers and watch how they do it. That's your best usability data.
- **No tutorial carousel.** Nobody reads them. Build the first-run flow so the app teaches itself.

### 5.7 How to actually test the UX

You cannot design this from Dhaka behind a laptop. The single highest-leverage thing you can do in the next month:

1. **Go to ten shops. Watch, don't demo.** Watch them use their notebook for one hour each. Photograph the notebooks (with permission). How is a page laid out? What's in the columns? What do they write when someone pays partially? What's crossed out and why?
2. **Count the transactions.** How many credit entries per day? How many customers have open balances? What's the median amount? You need these numbers for both the product and the paper's introduction.
3. **Ask what goes wrong.** Not "would you use an app" — everyone says yes to be polite. Ask "when was the last time you lost money because of the notebook?" and "who owes you money that you've given up on?" Concrete past events, not hypothetical futures.
4. **Then, with a paper prototype**, ask them to record a fake transaction. Time it. Watch where they hesitate.
5. **Once you have a build:** hand them the phone and say nothing. Every time you want to explain something, that's a design bug — write it down instead of speaking.

This is also the beginning of Option B's data collection, and it is what your v1 conspicuously lacks — the README describes a system designed from technical possibilities outward rather than from the counter inward.

---

## Part 6 — Build order

The ordering principle: **each phase produces something a real shopkeeper could use, and nothing is built before the thing it depends on.** No phase starts until the previous one's exit criterion is met.

I am deliberately not putting week numbers on these because I don't know your team size or availability. Ask me after you answer Part 7 and I'll add a calendar.

### Phase 0 — Field research and decisions
*Before any code.*

- Visit 10+ shops (§5.7). Produce a written findings document with real numbers.
- Resolve §2.1 (voice strategy), §2.2 (RN vs native + APK budget), §2.3 (cross-shop scope), §2.4 (what requirement 6 means).
- Choose **one** research option from §4.2. Write a one-page proposal: hypothesis, method, baselines, metrics, what data you need, when collection must start.
- Start ethics/IRB if needed.
- **If your chosen option needs field data (A, B, or D): begin collecting now.** Even paper-based. Even from three shops.

**Exit:** a findings document, four resolved decisions, one chosen research question, data collection started.

### Phase 1 — Domain core
*No UI. No database. No network.*

- `money.js` with the poisha discipline.
- Event type definitions with `schema_version` from event #1.
- `fold(events) → { balance, history }`
- `applyCredit`, `applyPayment`, `applyCorrection` — pure, returning events or typed errors.
- Anomaly detection (negative balance, duplicate payment).
- **Unit tests, including property-based tests**: for any random sequence of credits and payments, the fold is order-independent under HLC sort, balance never silently disagrees, and correction events are idempotent.

**Exit:** `npm test` runs in under 5 seconds and covers every financial rule. This is your foundation; do not proceed until it's solid.

### Phase 2 — Local storage and the core loop
*Still no network.*

- SQLite: `events` table + `customers`/`balances` projections. Projection rebuild from log.
- Screens: Home, Customer list, Add customer (one field), Record credit, Record payment, Customer detail with history.
- Full Bangla and English strings via explicit `t()`. **No monkey patching.**
- APK size gate in CI.

**Exit:** a shopkeeper can use it all day with no internet and lose nothing. Test by killing the app mid-flow repeatedly. Time the credit-entry flow — under 8 seconds or iterate.

### Phase 3 — Sync
- Server: auth, `POST /v1/events`, `GET /v1/events?since=`, health. Postgres.
- Client: push unsynced, pull remote, background task, exponential backoff with jitter, circuit breaker.
- **Two-device convergence test as a CI job**, not a manual check.
- Encrypt the local database. Bind refresh tokens to a device fingerprint with rotation.

**Exit:** two devices, both taken offline, both edited, both reconnected → identical state, or a clearly surfaced review item. Automated.

### Phase 4 — Inventory and reporting
- Product list, stock in/out as events, low-stock and expiry alerts.
- Daily summary: sales, credit given, payments received, cash position.
- Aging view — **requirement 7, the safe within-shop version.**

**Exit:** the shopkeeper can answer "how much am I owed, and by whom, and how long?" in one screen.

### Phase 5 — Forecasting and risk
- SBC demand classification → route to SES / Croston / SBA / TSB / Markov.
- Reorder point with an editable service level and lead time.
- Shopkeeper-editable seasonal multipliers.
- Rule-based overdue flags with plain-language reasons.
- **Benchmark harness** — this is Option D's experiment, and it lives in the repo.

**Exit:** every model beats a naive baseline on your data, measured with MASE/RMSSE, with model size and on-device latency recorded. Anything that doesn't beat naive gets deleted.

### Phase 6 — Voice
*Only after Phases 1–5 are stable.*

- Closed-vocabulary keyword spotting per §2.1 Option C.
- Slot-filling FSM. **No PIN-by-voice.**
- Bengali and Arabic digit normalisation.
- Always a visible touch fallback; two failures → hand back to touch.
- **This is Option A's evaluation if you chose it.**

**Exit:** voice completes a credit entry faster than touch for at least some users, in a noisy environment, measured.

### Phase 7 — Optional extras
OCR of handwritten ledgers (there is good Bangla handwriting work to build on — Ekush, BanglaLekha-Isolated, BanglaWriting, CMATERdb, BN-HTRd, and MobileNet-based recognisers designed for mobile — but handwritten *page* recognition in the wild is genuinely hard; scope it to digits-and-amounts first). SMS reminders (check Bangladesh Bank and BTRC rules first). USSD (requires an operator relationship you probably don't have).

---

## Part 7 — What I need from you

I have deliberately not guessed at these. Several parts of the plan above change materially depending on the answers.

1. **Who is building this?** Solo, a pair, a team? How many hours per week? This determines whether the build order takes 4 months or 14.

2. **What is this academically?** Undergrad final-year project, MSc thesis, independent work, or funded research? Do you have a supervisor, and what's their field? This affects venue choice and what counts as a sufficient contribution.

3. **Is there a deadline?** ICCIT 2026 is 18–20 December, so submission is likely months earlier — but I did not verify the date and you should check `iccit.org.bd/2026`. If you're aiming at it, everything compresses and Option A or D becomes much more likely than B.

4. **Do you have shop access?** Do you personally know shopkeepers who would let you observe and later pilot? How many? This is the single biggest input into the research-option choice.

5. **Do you have any real data yet?** Any transaction records, any shopkeeper interviews, any sales history at all? Or is everything currently synthetic/seeded (`seedData.js`)? If everything is synthetic, that's the most urgent thing to fix.

6. **React Native or open to alternatives?** Related: is requirement 5 a hard number you'll enforce, or a general preference? (§2.2)

7. **What does requirement 6, "security of public information," mean?** (§2.4)

8. **On requirement 7 — did you intend the within-shop version or the cross-shop version?** (§2.3) If cross-shop, I'd like to talk through the design and the harms before you build it, because it changes both the architecture and the paper.

Answer these and I'll produce: a calendared build schedule, a concrete data model with the full event catalogue, the paper outline with a related-work skeleton for your chosen option, and a screen-by-screen UI spec.

---

## Appendix — Literature found, by area

Papers I located during this search that are relevant to your related-work section. **Verify every citation yourself before using it** — retrieve the paper, check the venue and year, and confirm it says what the summary suggests. I have not read all of these in full.

**Bengali / Bangla ASR (requirement 10)**
- Bangla-Wave: wav2vec2 fine-tuned on Bengali Common Voice with n-gram LM rescoring — ICSCA 2023
- Bengali Common Voice speech dataset (Alam et al., 2022) — ~399 hours, the largest open Bengali corpus
- OOD-Speech (Rakib et al., 2023); RegSpeech12 (Hassan et al., 2025) — out-of-distribution and regional dialect corpora
- BanglaDialecto — end-to-end regional speech standardisation
- BanglaTalk — real-time speech assistance for Bengali regional dialects (arXiv 2510.06188); useful survey of the field in its related-work section
- Mridha et al. — survey of challenges and opportunities in Bengali speech recognition, *Artificial Intelligence Review*
- Comparative study of Whisper vs Wav2Vec-BERT on Bangla (arXiv 2507.01931) — directly relevant to your §2.1 decision

**Code-mixed / Banglish NLP (requirement 3)**
- TB-OLID — transliterated Bangla offensive language, 5,000 annotated comments (BLP workshop 2023)
- SentMix-3L, EmoMix-3L, OffMix-3L — Bangla-English-Hindi code-mixed test sets
- BnSentMix — Bengali-English code-mixed sentiment
- BanglishRev — large-scale Bangla-English code-mixed e-commerce reviews (arXiv 2412.13161)
- MixSarc — code-mixed corpus for implicit meaning (arXiv 2602.21608)
- BanglaBERT / BanglishBERT — the standard pretrained baselines
- **Gap for Option A: none of these covers transactional intent + slot filling.**

**ICTD / HCI (requirement 1, Option B)**
- ADB Institute — 12-month RCT on digital financial service adoption among low-income Bangladeshi microentrepreneurs
- Mustafa et al., CHI 2019 — digital financial needs of micro-entrepreneur women (Pakistan); closest methodological template
- Hazra et al., *EJISDC* 2021 — affordances of MFS in Bangladesh
- Akhter & Khalily, 2020 — MFS and financial inclusion in Bangladesh
- Work on usability, fraud, and security practices of low-literate MFS users in rural Bangladesh
- Cambridge Elements — mobile banking and access to public services in Bangladesh

**Offline-first / sync (Option C)**
- Shapiro et al., 2011 — CRDTs, the foundational reference
- Balegas et al., 2015 — invariant preservation under replication; your plan cites this correctly
- Kleppmann et al., "Local-first software" (Ink & Switch) — the framing paper for this space
- CAMS-F Edge DTN, *Future Internet* 2026 — CRDTs plus opportunistic sync under intermittent connectivity; recent and close to your problem

**Credit risk (requirement 7)**
- ML for micro-credit scoring — MDPI *Risks* 9(3):50, Ghanaian microfinance data; a good methodological template
- Systematic reviews of ML for microfinance credit risk (boosted ensembles dominate, but interpretability is the blocker)
- Explainable and calibrated PD models under IFRS 9, in a Bangladesh Bank context — useful for the calibration/PSI discussion
- Note: several Bangladesh-authored loan-prediction papers report ~99.99% accuracy. Treat these with suspicion; that figure almost always indicates target leakage. Do not cite them as evidence of feasibility.

**Bangla OCR (requirement 11)**
- Ekush — 367,018 handwritten characters from 3,086 writers; EkushNet baseline ~97.7%
- BanglaLekha-Isolated (~166k characters), CMATERdb, AIBangla
- BanglaWriting — 260 full-page handwritten documents with word ground truth
- BN-HTRd / BN-DRISHTI — full-page segmentation, 786 documents
- MobileNet V1 for Bangla handwritten character recognition — the on-device-friendly baseline
- Note the gap between isolated-character accuracy (very high) and full-page real-world recognition (much harder). Scope accordingly.

**Intermittent demand forecasting (requirement 8, Option D)**
- Croston (1972) — the origin of intermittent demand forecasting
- Syntetos–Boylan Approximation (SBA); Teunter–Syntetos–Babai (TSB) — the standard corrections
- Markov-combined method for intermittent demand, *Journal of Retailing and Consumer Services* — two-stage demand/inventory state transitions, beats SES/SBA/Croston on Alibaba and JD data. **This is your closest prior work.**
- Higher-order Markov chain models for intermittent demand (IJICIC)
- Syntetos–Boylan–Croston demand classification (ADI / CV²) — how you route SKUs to methods

**Commercial landscape — cite this, you have competitors**
TallyKhata (Bangladesh; described as the largest MSME platform there, reported to be over a million monthly active users, with a Bangladesh Bank-licensed wallet), Jama Khata (Bangladesh), KhataBook / OkCredit (India), DigiKhata / Udhaar Book (Pakistan). A reviewer *will* ask what Hisab does that TallyKhata doesn't. Have a real answer, and note that the SME Foundation figure of roughly 7 million small businesses in Bangladesh still on paper ledgers appears in industry sources — **verify it at the primary source before citing.**
