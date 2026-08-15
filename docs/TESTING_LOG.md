# TESTING_LOG.md

**Owner:** Both. This is the kill-app test matrix from `docs/BUILD_PLAN.md`
Phase 2 ("background the app at every step of every flow, repeatedly") as an
actual checklist, not open-ended poking. Run through it by hand against a
real emulator or device — Maestro flows for the same matrix live in
`apps/mobile/maestro/kill-app/` and are the repeatable version, but they
can't run until Step 8 ships the six real screens. This document works
today, on whatever exists, and stays the reference either way.

**Log every run below the table**, dated, with pass/fail per row — not just
the row description. A checklist that's never actually filled in is the
same as not having one.

---

## The matrix

| # | Screen | Flow | Interruption point | Expected recovery |
|---|---|---|---|---|
| 1 | Home | — | Idle, no input in flight | Reopens showing current total owed + recent activity, unchanged. No crash-loop. |
| 2 | Customer list | Search | Mid-keystroke | Reopens with the same search text and filtered results — not reset. |
| 3 | Customer list | Scroll | Mid-scroll | Reopens at approximately the same position (soft — not correctness-critical). |
| 4 | Add customer | Entry | After 1 character typed | Reopens with that character still present. |
| 5 | Add customer | Entry | Full name typed, before save tap | Full name preserved, not yet written to the log. |
| 6 | Add customer | Entry | Immediately after save tap | Exactly one `CUSTOMER_ADDED` in the log — not zero, not duplicated. |
| 7 | Record credit | Who? | Search focused, before picking a customer | Reopens on Who?, search state preserved. |
| 8 | Record credit | Who? | Immediately after tapping a customer | Reopens on How much?, that customer still selected. |
| 9 | Record credit | How much? | After the first digit | Amount still shows that one digit — not reset to 0. |
| 10 | Record credit | How much? | Mid-entry, several digits + a quick-chip tap | Full composed amount preserved exactly. |
| 11 | Record credit | How much? | Immediately after confirm tap | Exactly one `CREDIT_GIVEN` for that amount; not re-prompted as a lost draft; balance reflects it. |
| 12 | Record credit | Done | During the 10s undo window | Same Done state, correct remaining undo time (or a reasonable closed-window fallback); undo still voids the right entry. |
| 13 | Record payment | How much? | Mid-edit of the pre-filled balance amount | The *edited* amount is preserved, not reverted to the pre-fill default. |
| 14 | Record payment | How much? | Immediately after confirm | Exactly one `PAYMENT_RECEIVED`, no duplicate, no loss. |
| 15 | Customer detail | History | Viewing, no input | Reopens on the same customer, same scroll position. |
| 16 | Customer detail | Show customer | Show-customer mode active | Reopens back into show-customer mode — not silently exited. |

---

## Run log

Append a new dated section per session. One row per matrix item actually
exercised — "ran the whole matrix" with no per-row detail doesn't count.

### 2026-08-15 — mechanism check only (Gallery, not the real screens)

**Not a run of the matrix above.** The six core screens don't exist yet
(`apps/mobile/src/screens/` is empty — Step 8 hasn't started). What was
actually verified today was that the *tooling* works at all: Maestro
installed, an emulator boots, `killApp`/`launchApp` correctly exercises a
real cold-start-after-kill cycle, and a locale toggle's non-persistence
(Gallery has none, deliberately) is correctly observable as "resets to
default," not silently passing either way. See
`apps/mobile/maestro/gallery-smoke.yaml` for the exact flow and this
session's report for the actual pass/fail output.

Once Step 8 ships real screens with the `testID`s listed in
`apps/mobile/maestro/kill-app/README.md`, this section is where the first
real per-row run gets logged.
