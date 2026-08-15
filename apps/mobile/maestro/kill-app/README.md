# Kill-app matrix — prepared, not runnable yet

**These flows cannot run today.** `apps/mobile/src/screens/` is empty — the
six core screens (`docs/UI_SPEC.md`) are Step 8's job and haven't been built.
Every `tapOn`/`assertVisible` selector below references a `testID` or string
that doesn't exist in any running app yet.

What these files are: the kill-app test matrix (flow × interruption point ×
expected recovery state), drafted ahead of the screens so Step 8 has a
concrete, already-agreed contract for what testIDs each screen needs to
expose, rather than Maestro flows being retrofitted after the fact. `../gallery-smoke.yaml`
is the one flow in this repo that actually runs today — it proves the
Maestro + adb + kill/relaunch mechanism itself works, against the one real
screen that exists (`Gallery`).

`docs/TESTING_LOG.md` has the same matrix as a literal manual checklist —
run that by hand against Gallery/App shell today; once Step 8 ships, wire
these flows up (add the `testID`s each `- id:` comment names) and switch to
running this directory for real.

## testID contract each screen needs to expose

| Screen | testIDs Step 8 needs to add |
|---|---|
| Home | `home.creditButton`, `home.totalOwed` |
| Customer list | `customerList.search`, `customerList.row.<id>` |
| Add customer | `addCustomer.nameInput`, `addCustomer.save` |
| Record credit | `recordCredit.search`, `recordCredit.customerRow.<id>`, `recordCredit.keypad`, `recordCredit.confirm`, `recordCredit.undo` |
| Record payment | `recordPayment.amountInput`, `recordPayment.confirm` |
| Customer detail | `customerDetail.history`, `customerDetail.showCustomerToggle` |
