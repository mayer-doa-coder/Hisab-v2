# CLAUDE.md

## Read AGENTS.md first

**[`AGENTS.md`](./AGENTS.md) is the canonical instruction file for this repository.** It contains the architecture rules, the forbidden patterns, the commands, and the code conventions. Read it fully before your first edit in a session.

This file contains only the Claude Code–specific workflow on top of that. **Do not duplicate content from `AGENTS.md` here** — if the two files disagree, `AGENTS.md` wins, and the disagreement is a bug to fix.

---

## The 60-second version

Hisab is an offline-first ledger for small shops in Bangladesh. It records customer credit (baki) and repayment (joma). The user is a shopkeeper with a customer waiting at the counter.

Five rules, all expanded in `AGENTS.md` §3:

1. `packages/domain/` has **zero I/O** — no react, no expo, no sqlite, no fetch
2. Money is an **integer count of poisha**, arithmetic only in `money.ts`
3. The **event log is append-only**; balances are folds, never stored fields
4. **25 MB APK budget**, enforced in CI — every dependency justifies itself
5. **Credit entry in under 8 seconds and 5 taps** — no spinners, no confirm dialogs, no network in core flows

This is a rebuild. The previous version is archived at `Hisab-v1`. Most rules exist to prevent a bug that actually happened; `AGENTS.md` §4 lists them with the specific failure each one prevents.

---

## Session start

At the beginning of a session, before proposing changes:

1. Read `AGENTS.md` in full.
2. Read `AGENTS.md` §11 (current phase) — work outside the current phase is out of scope.
3. Check `git status` and the current branch. Branch prefixes indicate ownership: `a/*` is Core & Data, `b/*` is Interface & Field.
4. If the task touches `packages/domain/src/types.ts`, `packages/domain/src/index.ts`, or `apps/mobile/src/viewmodels/`, **stop and say so.** Those three are jointly owned and changing them requires both team members to agree.

---

## Plan before editing

For anything beyond a one-file change, use plan mode or write out the plan first. State:

- Which files you'll touch, and **which owner's directory each belongs to** (see `.github/CODEOWNERS`)
- Which tests you'll add or change
- Whether any new dependency is needed, and its approximate APK cost
- Whether any rule in `AGENTS.md` §3 or §4 comes into tension with the request

If the plan spans both A's and B's directories, that is usually two pull requests. Say so and ask which half to do.

---

## Verification is not optional

Before reporting a task complete, run and report the actual output of:

```bash
npm run typecheck
npm test
npm run lint
```

And if the change touches `apps/mobile/`:

```bash
npm run size:check
```

**Do not say "tests should pass" or "this should work."** Run it. If you cannot run it, say explicitly that you did not verify and what would need to be checked.

For domain changes, `npm test -w packages/domain` must complete in under 5 seconds. If it starts getting slower, something has acquired I/O and rule 1 is broken.

---

## Things Claude gets wrong on this project

Patterns worth being deliberately careful about here, because the training-data default points the wrong way:

- **Reaching for a library.** The instinct to `npm install` a date library, a decimal library, a state manager, or a CRDT package is almost always wrong here. The 25 MB budget means a 40-line hand-written helper often beats a dependency. Ask first.
- **Storing computed values "for performance."** Caching a balance on the customer row looks like an optimisation and is the exact bug that sank v1. Balances are folds. If a fold is slow, fix the projection layer, don't denormalise the source of truth.
- **Adding a loading state.** In an offline-first app the local write has already happened. A spinner is a lie that teaches the user to distrust the app.
- **Adding a confirmation dialog.** For a high-frequency action, a confirm dialog taxes every user forever to prevent a rare error. Use undo.
- **Being helpful by adding extra fields.** A form with name, phone, address, credit limit, and due terms is not more useful than one field — it is slower at the counter and it is a data-protection liability. Collect the minimum.
- **Softening a refusal into a workaround.** If a request conflicts with `AGENTS.md` §3 or §4, say so plainly. Do not add an `eslint-disable`, do not route around the domain-layer import ban, do not quietly widen a budget.
- **Inventing numbers.** See `AGENTS.md` §9. Never produce a citation, a statistic, a benchmark result, or a "typical" figure you haven't verified. Say "I don't know" and mark it `[VERIFY]`.

---

## Bengali content

When writing or reviewing Bengali strings:

- Both `bn` and `en` keys change in the same commit
- Indian grouping: `12,34,567`
- Do not hardcode Bengali numerals (০-৯) for money — numeral script is a user setting
- Use the words shopkeepers use: বাকি (credit given), জমা (payment received), দোকান (shop), মাল (goods)
- Facts, not scores: `৪৫ দিন ধরে কিছু দেননি`, never `উচ্চ ঝুঁকি`

If you are unsure whether a Bengali phrase reads naturally to a shopkeeper, say so and flag it for a native check rather than guessing. Register matters here — formal written Bangla and counter Bangla are not the same language.

---

## Commits and pull requests

- Conventional commits: `feat(domain): add correction event fold`
- Scope is the workspace: `domain`, `mobile`, `server`, `docs`, `research`, `ci`
- One concern per PR. More than ~8 files means split it.
- Rebase onto `main`, never merge `main` into a branch
- Fill out `.github/pull_request_template.md` honestly, including the "I did not verify" boxes where true
- Append to `docs/DECISIONS.md` for any non-obvious choice — four lines, considered / chose / because

---

## When you find existing code that violates AGENTS.md

Report it. Do not fix it inside an unrelated change — that creates a PR that touches two owners' directories and buries a real issue in a diff about something else.

Open an issue, or list the violations at the end of your response, and let the team schedule the fix.
