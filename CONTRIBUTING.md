# CONTRIBUTING.md

Two people work in this repository. Everything below exists to make merge conflicts **structurally impossible** rather than merely unlikely, and to keep the financial core correct.

Machine-readable rules for AI agents are in [`AGENTS.md`](./AGENTS.md). This file is for humans and covers process.

---

## 1. Ownership: directories, not features

**A — Core & Data.** Domain layer, event store, SQLite, projections, sync, server, security, CI.
**B — Interface & Field.** Design system, screens, navigation, i18n, search, field research, dataset, paper.

**Neither person ever edits a file in the other's directory.** If B needs a change in the domain layer, B opens an issue; A makes the change. This feels slow for about three days and then feels obviously correct.

Ownership is written down in [`.github/CODEOWNERS`](./.github/CODEOWNERS). If GitHub requests a review from both of you on one PR, that PR is touching both halves — split it.

Balance check: A has more lines of code. B has the shop visits, the utterance collection, and the paper, which are the calendar-heavy items. It works out.

---

## 2. The three shared files

Exactly three things are jointly owned:

1. `packages/domain/src/types.ts` — event and command types
2. `packages/domain/src/index.ts` — the public API surface B imports from
3. `apps/mobile/src/viewmodels/` — the shapes B's screens render

Write all three in a **single session, both present, committed once**, in Phase 0 before any feature work. After that, a change requires both of you to agree.

The viewmodel boundary is what makes parallel work safe:

```ts
// apps/mobile/src/viewmodels/customer.ts
export interface CustomerRowVM {
  id: string;
  displayName: string;             // the nickname
  balanceDisplay: string;          // PRE-FORMATTED — B does no money arithmetic
  daysSinceActivity: number;
  needsAttention: boolean;         // computed by domain, rendered by UI
  attentionReason: string | null;  // plain language: "৪৫ দিন ধরে কিছু দেননি"
  syncPending: boolean;
}
```

**B never performs arithmetic on money and never decides who is overdue.** Those are domain concerns, already tested. B renders strings.

---

## 3. Files that cause conflicts, and the rule for each

| Conflict source | Rule |
|---|---|
| `package.json` / `package-lock.json` | **A owns all dependency changes.** B never runs `npm install <pkg>`. B requests; A adds it in a standalone PR merged the same day. Lockfile conflicts are the number one source of pain in small teams. |
| Barrel files (`index.ts` re-exporting everything) | **Do not use them for screens or components.** Both people append an export at the bottom of the same file; that is a conflict every time. Import from the specific path. The one exception is `packages/domain/src/index.ts`, which is a deliberate API surface. |
| A single large locale file | **Split by namespace:** `i18n/bn/customers.ts`, `i18n/bn/products.ts`, `i18n/bn/common.ts`. B owns all of them; the split still helps across B's own sessions. |
| Navigation route registry | B owns it entirely. A never adds a screen. |
| SQL migrations | **Numbered and append-only:** `001_events.sql`, `002_projections.sql`. Never edit a migration after it merges. A owns all of them. |
| `README.md` | Edit rarely, and never in the same PR as code. |
| `docs/DECISIONS.md` | Append at the bottom only. Never edit an existing entry. That makes it conflict-free by construction. |

---

## 4. Git workflow

```bash
# Branch prefix declares the owner — you never need to look at each other's branches
git checkout -b a/event-store
git checkout -b b/customer-list-screen

# ALWAYS rebase. Never merge main into a branch.
git fetch origin
git rebase origin/main
git push --force-with-lease
```

**Rules:**

- **Merge to `main` at least once a day.** A branch that lives a week will conflict no matter how cleanly the directories are divided, because refactors happen.
- **Small PRs.** One screen. One module. More than ~8 files means split it.
- **Squash merge.** Keeps `main` readable, which matters when you write the thesis and need to reconstruct what happened when.
- **CI must be green.** No exceptions, including for "small" changes.
- **No required approvals.** With two people, mandatory review is a blocker. Instead: read each other's merged PRs at the end of each day. You will catch things without gating.

### Commit messages

Conventional commits. Scope is the workspace.

```
feat(domain): add ENTRY_VOIDED fold with idempotency test
fix(mobile): persist credit-entry draft on every keystroke
chore(ci): raise size gate output verbosity
docs(events): document SEASONAL_MULTIPLIER_SET payload
```

Scopes: `domain`, `mobile`, `server`, `docs`, `research`, `ci`.

---

## 5. Definition of done

A change is not done until all of these are true:

- [ ] `npm run typecheck` passes (strict, no new `any`, no new `@ts-ignore`)
- [ ] `npm test` passes
- [ ] `npm run lint` passes with zero warnings
- [ ] `npm test -w packages/domain` still runs in **under 5 seconds** (if it slowed down, something acquired I/O — see `AGENTS.md` §3.1)
- [ ] `npm run size:check` passes if `apps/mobile/` changed
- [ ] New domain functions have unit tests; anything touching money has a property test
- [ ] Any new event type completed the six-item checklist in `docs/EVENTS.md` §9
- [ ] Non-obvious decisions appended to `docs/DECISIONS.md`
- [ ] `bn` and `en` strings both added in the same commit

---

## 6. Adding a dependency

Only A does this, and only after answering three questions in the PR description:

1. **What does it do** that we cannot do in under 100 lines?
2. **What does it cost** in APK bytes? (Measure with `apkanalyzer`, don't guess.)
3. **What breaks** if we don't have it?

The budget is 25 MB per-ABI, enforced in CI. In v1 this single gate would have blocked ONNX Runtime, BullMQ, three of five font weights, and the ONNX voice-pack downloader.

Dependencies that are scaffolded but unused get deleted, not kept "for later."

---

## 7. Reviewing each other's work

Not a merge gate — a daily habit. At the end of the day, read what the other person merged. Look for:

- A stored value that should have been derived (the v1 bug)
- Money arithmetic outside `money.ts`
- An import in `packages/domain/` that touches the platform
- A new screen that isn't in `docs/UI_SPEC.md`
- A spinner on a local write, or a confirmation dialog on a high-frequency action
- A number in a comment or doc with no source

---

## 8. Working with AI agents

Both of you will use coding agents. Rules so that doesn't create conflicts or drift:

- **The agent works in your directory only.** If it proposes edits across both owners' directories, split the task.
- **Never merge agent output you have not read.** Especially in `packages/domain/` — that is the financial core.
- **Agents must not add dependencies.** They propose; A decides.
- **Agents must not invent numbers or citations.** See `AGENTS.md` §9. Anything unverified is marked `[VERIFY]` and checked by a human before it reaches the paper.
- Keep `AGENTS.md` §11 (current phase) up to date. It is how the agent knows what is in scope.

---

## 9. Phase discipline

The build order is in `docs/BUILD_PLAN.md`. Each phase has an exit criterion; the next phase does not start until it is met.

**The rule that matters most:** six core screens ship to one real shop before a seventh screen exists. v1 had roughly fifty screens and no test suite. Resist the seventh screen until a shopkeeper has used all six for two weeks.
