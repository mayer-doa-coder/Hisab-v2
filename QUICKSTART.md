# QUICKSTART

Get Hisab v2 running from a fresh clone. This file is a practical run guide;
for what the project *is* and the rules it follows, read [`AGENTS.md`](./AGENTS.md)
first — it's the canonical instruction file and this document assumes you've
at least skimmed it.

---

## 1. What you're running

Hisab is an **offline-first mobile ledger** for small shops in Bangladesh. A
shopkeeper records customer credit (বাকি — "baki") and repayment (জমা —
"joma") instead of writing it in a paper notebook. The core design idea:

- Every write is an **event** (`CREDIT_GIVEN`, `PAYMENT_RECEIVED`, ...),
  appended to a local, never-edited log. A customer's balance isn't a stored
  number — it's *computed* by replaying their events. This is what lets two
  offline phones sync later without corrupting each other's data.
- The app works with **zero network calls** in its core flows. Nothing you
  do at the counter waits on a server.
- Money is always an integer count of poisha (1 taka = 100 poisha), never a
  float — see `AGENTS.md` §3.2 if you're curious why.

**Repo layout**, in one line each:

```
packages/domain/    pure TypeScript — the ledger rules, zero I/O, shared by app and server
apps/mobile/         the Expo/React Native app — this is what you'll actually run
server/              Node + Postgres — auth and event sync (optional for local use)
docs/                the actual specs (UI_SPEC.md, EVENTS.md, BUILD_PLAN.md, ...)
```

---

## 2. Prerequisites

| Need | Notes |
|---|---|
| **Node.js 20** (LTS) | Pinned in `.nvmrc`. Node 24 also works and is what this repo has been developed/tested against most recently. |
| **npm** | Ships with Node. This is an npm workspaces monorepo (`packages/domain`, `apps/mobile`, `server`) — one `npm install` at the root sets up all three. |
| **The Expo Go app** | Install it on your phone from the Play Store / App Store. This is the fastest way to run `apps/mobile` — no Android Studio or Xcode required. |
| **Git** | To have the repo at all. |

Only needed for the optional sections below:

| Need | For |
|---|---|
| Android Studio + a JDK (17–21) | Building a real `.apk` (§6) |
| PostgreSQL | Running `server/` (§5) — not required to use the app itself |

---

## 3. Install

From the repository root:

```bash
npm install
```

This installs dependencies for all three workspaces at once (`npm install`
inside `apps/mobile/` or `server/` individually also works, but installs less
than doing it from the root, so prefer the root command).

---

## 4. Run the mobile app

```bash
cd apps/mobile
npm start
```

This runs `expo start` and prints a QR code in your terminal. Scan it with
the Expo Go app on your phone (Android: Expo Go's built-in scanner; iOS: the
system Camera app). The JS bundle loads over your local network — make sure
your phone and computer are on the same Wi-Fi.

> If you have an old global `expo-cli` installed, you may see a warning like
> `"legacy expo-cli does not support Node +17"` — ignore it. `npm start`
> always uses the modern, local `expo` CLI from this project's own
> `node_modules`, not the global one.

### What you'll see

The app opens with three tabs at the top:

- **Hisab** — the real app. Home → total owed to you, one big বাকি লিখুন
  (record credit) button, recent activity. From there you can add a
  customer, record a credit or payment, undo it within 10 seconds, and open
  a customer's full transaction history.
- **Phase 4** — a developer preview of the inventory/aging screens, driven
  by a synthetic demo ledger (not your real data).
- **Gallery** — the raw design-system components in isolation.

Everything you do in the **Hisab** tab writes to a real local SQLite
database on your phone (via `expo-sqlite`) — it persists across app
restarts, same as the real product would.

### A quick walkthrough

1. Tap **বাকি লিখুন** (record credit) on Home.
2. You land on "Who?" — search or tap **+ নতুন** to add a first customer
   (name is the only required field).
3. Type an amount on the full-screen keypad, or tap a quick-amount chip
   (৫০ / ১০০ / ২০০ / ৫০০ / ১০০০ — tap repeatedly to add more), then hit the
   ✓ key.
4. You're on the Done screen: new balance, a 10-second **Undo**, and a
   "show the customer" full-screen view.
5. From Home, tap **সবাইকে দেখুন** (see everyone) to browse the full
   customer list, open a customer, and record a payment or see their full
   history with a running balance per line.

---

## 5. Run the server (optional)

Not required to use the app — the six core screens are fully offline. The
server is for cross-device sync (still being built) and isn't wired into the
mobile app's UI yet.

```bash
createdb hisab   # or however you provision a Postgres database

cd server
DATABASE_URL=postgres://localhost/hisab npm start
```

`npm start` builds the TypeScript, then runs `server/migrations/*.sql` in
order automatically before listening (default port `8080`, override with
`PORT=...`). No separate migration step needed.

---

## 6. Building a real `.apk` (optional, advanced)

Only needed if you want to measure the app against the 25 MB size budget
(`AGENTS.md` §3.4) or test a real release build rather than the Expo Go dev
bundle:

```bash
cd apps/mobile
npm run build:apk     # release build, arm64-v8a
npm run size:check    # measures the result against the 25 MB budget
```

This needs a real Android SDK and a JDK between 17 and 21 — `build-apk.mjs`
tries to auto-detect a compatible one (JAVA_HOME, PATH, or Android Studio's
bundled JBR, in that order) and explains what it found if it fails. This can
take several minutes on first run.

---

## 7. Verifying your setup / running tests

```bash
npm run typecheck   # strict TypeScript across all three workspaces
npm test             # domain tests finish in well under 5 seconds; mobile ~1s
npm run lint          # eslint, including the project's own custom rules
                       # (e.g. money arithmetic is only allowed in money.ts)
```

Run these from the repo root. If any of them fail on a clean clone, that's
worth reporting before you start changing anything.

---

## 8. Where to go next

- [`AGENTS.md`](./AGENTS.md) — the real rulebook: architecture constraints,
  forbidden patterns, and *why* each rule exists.
- [`docs/UI_SPEC.md`](./docs/UI_SPEC.md) — the six core screens, specified
  in detail.
- [`docs/EVENTS.md`](./docs/EVENTS.md) — the event catalogue (what gets
  logged, and what each field means).
- [`docs/BUILD_PLAN.md`](./docs/BUILD_PLAN.md) — the phase-by-phase plan
  this project is actually following.
- [`docs/DECISIONS.md`](./docs/DECISIONS.md) — an append-only log of every
  non-obvious choice made so far, with the reasoning. Genuinely useful for
  understanding *why* the code looks the way it does in odd corners.
