# UI_SPEC.md

**Owner:** B · Full design reasoning is in §5 of `HISAB_V2_REBUILD_AND_RESEARCH_PLAN.md`. This file is the buildable specification.

---

## The one constraint everything else serves

**A customer is standing at the counter, waiting.** Every core action competes with a paper notebook that takes about four seconds. If recording a baki takes longer, the shopkeeper reaches for the notebook and the app is dead.

**Target: credit entry complete in under 8 seconds and 5 taps.** Measure it with a stopwatch in a real shop, not on a laptop. Treat a regression as a bug.

---

## Physical constraints

| Constraint | Consequence |
|---|---|
| One hand, one thumb — the other holds goods or cash | All primary actions in the lower half of the screen. Top is read-only. |
| Interruptions are constant | Draft state persists to disk on **every field change**, not on submit. The app must survive being backgrounded at any step and return exactly where it was. |
| Cracked glass, scratched protectors, shopfront glare, dirty hands | Minimum 48dp touch targets, generously spaced. High contrast. Never rely on subtle colour differences alone. |
| The amount is the most important thing on screen | Largest element. Never truncated, never wrapped, never in a light weight. |
| The phone faces one way; a paper ledger faces both | A customer-facing view is required, not optional. |

---

## The six core screens

Nothing else ships until a shopkeeper has used all six for two weeks.

| # | Screen | Must do | Must NOT do |
|---|---|---|---|
| 1 | **Home** | Total owed to me. One large button: বাকি লিখুন. Recent activity. | No KPI grid, no charts, no period selector |
| 2 | **Customer list** | Recent-first. Name + balance + days since activity. Search across Bangla / Banglish / phone. | Not alphabetical. No risk badges. |
| 3 | **Add customer** | **One required field: what you call them.** Phone optional. | Not five fields. No credit limit, due terms, or address at creation. |
| 4 | **Record credit** | Who → how much → done. Full-screen keypad. Quick chips ৫০/১০০/২০০/৫০০/১০০০. Undo 10s. | No spinner. No confirm dialog. No system keyboard for the amount. |
| 5 | **Record payment** | Same flow, pre-filled with the full balance, editable. | No spinner. |
| 6 | **Customer detail** | Running balance, full history, "show customer" mode. | No risk score anywhere a customer might see it. |

---

## The credit-entry flow, step by step

```
[Home]
   ↓  one large button, bottom of screen, thumb-reachable
[Who?]
   • Search field, already focused, keyboard already open
   • Below: last 8 customers, most recent first, large tappable rows
     showing initial/photo + nickname + current balance
   • Search matches Bangla name, Banglish name, and phone in one pass
   • "+ নতুন" always visible at the bottom
   ↓
[How much?]
   • Full-screen numeric keypad — NOT a text input with the system keyboard
   • Amount renders huge at the top as it is typed
   • Quick chips ৫০ ১০০ ২০০ ৫০০ ১০০০ — tap to add, tap again to add again
   • Confirm is the bottom-right key of the keypad itself
   ↓
[Done]
   • Immediate. No spinner. The write already happened locally.
   • Name, new total balance, UNDO for 10 seconds
   • One tap: show this to the customer
```

### Why each choice

- **Recent-first, not alphabetical.** Retail follows a strong recency and frequency distribution. Alphabetical is optimised for a filing cabinet, not a counter.
- **Nickname, not legal name.** See `docs/GLOSSARY.md`. v1's form required name, phone, address, credit limit, and due terms — five fields for someone standing at the counter.
- **Custom keypad, not the system keyboard.** The system keyboard is small, slow to appear, and offers a hundred irrelevant keys.
- **Undo, not confirm.** A confirm dialog taxes every user forever to prevent a rare error. Undo costs nothing and fixes the error when it happens.
- **No spinner on a local write.** The write is durable already. A loading state is a lie that teaches distrust.
- **"Show the customer" matters more than it sounds.** The paper ledger is socially trusted because it is *mutually visible* — the customer watches the number being written. Breaking that costs the shopkeeper a social tool. This is under-designed in existing khata apps and worth doing well.

---

## Bengali interface rules

- **Two font weights only.** Regular and Bold. v1 loaded five Anek Bangla weights at boot. Size and colour carry the rest of the hierarchy.
- **More line-height than Latin.** Ascenders, descenders, the matra (মাত্রা), and conjuncts all need vertical room. Under-leading is the most common typographic mistake in Bangla apps.
- **Test conjunct rendering on Android 8, 9, and 10** with `ক্ষ ঞ্জ স্ত্র ন্ত্র দ্ধ ট্ট`. Bengali text shaping had real bugs on older versions.
- **Left-align.** Never centre long Bengali text.
- **Indian grouping**: ১২,৩৪,৫৬৭.
- **Numeral script is a setting**, defaulting to Arabic for money. Verify empirically — timing shopkeepers reading amounts in each script is a small, clean experiment and a candidate figure for the paper.

---

## Uncertainty and risk

- **State the fact, not the score.** `গত ৩০ দিনে ২৫ কেজি বিক্রি হয়েছে` beats `Predicted demand: 24.7 ± 6.2 (confidence 0.71)`.
- **Always show the reason.** One line of plain language on every suggestion. A confidence bar means nothing to someone with no calibration for what 71% represents — say "based on the last 3 months" or "not much data yet" instead.
- **Say "I don't know."** With 5 days of history the correct output is `তথ্য কম — আরও কিছুদিন লাগবে`, not a forecast. Fabricated confidence destroys trust permanently, and trust is the only reason this app gets used twice.
- **Never render a risk score where a customer can see it.** A customer glancing at the counter phone and seeing themselves labelled HIGH RISK in red is a social harm we created. Use `৪৫ দিন`, never `উচ্চ ঝুঁকি`.

---

## Offline and sync, from the user's side

- **No offline banner.** Offline is the normal state, not an error. A permanent warning trains users to ignore warnings.
- Sync state is subtle: last-sync time, and a clear signal only after repeated failure over a long period.
- Each row carries its own sync dot (pending / synced) so nothing feels lost.
- The one thing that must be **loud**: unsynced data at logout or uninstall.

---

## Onboarding

- **Nothing before first value.** The first screen lets them record a baki. Account creation comes after they have seen it work. v1 required signup → email verification → PIN setup before the app was usable at all.
- **Phone number, not email**, as the identifier — that is what this population actually has and uses.
- **Seed nothing.** Let them add their first three customers and watch how they do it. That is the best usability data available.
- **No tutorial carousel.** Nobody reads them. The first-run flow teaches itself.

---

## Acceptance criteria — measured in a real shop

- Credit entry: **< 8 seconds, ≤ 5 taps**, home screen to confirmed
- Cold start to interactive: **< 3 seconds** on a 2 GB device
- Customer list scrolls at 60fps with 500 customers
- App survives backgrounding at every step of every flow
- Zero network calls in any core flow
- APK ≤ 25 MB per-ABI
