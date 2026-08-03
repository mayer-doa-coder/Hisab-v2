# GLOSSARY.md

Domain vocabulary. Included because both humans and AI agents will otherwise guess at these, and guessing wrong produces code and UI copy that reads as foreign to a shopkeeper.

## Bengali business terms

| Term | Script | Meaning in this system |
|---|---|---|
| **hisab** | হিসাব | Account, reckoning, calculation. The app's name. |
| **baki** | বাকি | Credit given — goods handed over now, payment later. The core event. Also used as a noun for the outstanding amount: "কত বাকি?" = "how much is outstanding?" |
| **joma** | জমা | Payment received against baki. The counterpart event. |
| **dokan** | দোকান | The shop. Small general store; the target user's business. |
| **dokandar** | দোকানদার | Shopkeeper. The user. |
| **khata** | খাতা | The physical notebook the ledger lives in today. The thing we compete with. |
| **mal** | মাল | Goods, stock, merchandise. |
| **becha** | বেচা | Sale, selling. |
| **kena** | কেনা | Purchase, buying (from a supplier). |
| **taka** | টাকা | The currency, BDT. Symbol ৳. |
| **poisha** | পয়সা | 1/100 of a taka. Our internal integer unit. Functionally obsolete in cash retail but used as the storage unit to avoid floats. |
| **bhai** | ভাই | Brother — extremely common address form. "রহিম ভাই" is how a shopkeeper knows a customer, far more than a legal name. |
| **apa** | আপা | Sister — the equivalent address form. |

## Why `display_name` is a nickname field

Shopkeepers do not know customers by legal name. They know "রহিম ভাই", "চেয়ারম্যান সাহেব", "the tailor", "the auto driver". `CUSTOMER_ADDED` requires exactly one field, and that field is what the shopkeeper calls them. Full name, address, and credit limit are not collected at creation and mostly not collected at all.

## Banglish

Bengali written in Latin script, typed on an English keyboard. Most shopkeepers do not have a Bangla keyboard installed or find it slow, so search must match "rohim" against রহিম.

Transliteration is many-to-many: রহিম may be typed rohim, rahim, rohem, rohim. Use phonetic normalisation plus edit distance, never an exact character map. Search matches Bangla name, Banglish name, and phone number in one pass.

**Code-switching** is the norm, not the exception. A real utterance looks like: *"Rahim bhai ke 500 taka baki dilam"* — Bengali grammar, English numerals, Latin script, mixed lexicon. This is the linguistic phenomenon the research contribution targets.

## Numbers

- **Indian grouping**: 12,34,567 — not 1,234,567. Lakh (লাখ, 100,000) and crore (কোটি, 10,000,000) are the units people actually think in.
- **Numeral script is a setting**, defaulting to Arabic (0-9) for money. Many shopkeepers read Arabic numerals faster for amounts because prices, banknotes, phone numbers, and calculators all use them. Bengali numerals are ০১২৩৪৫৬৭৮৯. This is being tested empirically — do not hardcode either.

## Seasonality

| Season | Note |
|---|---|
| **Ramadan** (রমজান) | Month-long. Demand shifts heavily toward iftar goods. Moves ~11 days earlier each solar year. |
| **Eid ul-Fitr** (ঈদুল ফিতর) | End of Ramadan. The largest demand spike of the year. |
| **Eid ul-Adha** (ঈদুল আজহা) | ~70 days after Eid ul-Fitr. Second major spike. |
| **Monsoon** (বর্ষা) | Roughly June-September. Supply disruption and changed footfall. |
| **Harvest** | Regional, crop-dependent. Affects cash availability, which affects baki repayment. |

Because the Islamic calendar is lunar, these move against the Gregorian year. Do not model them as fixed calendar dates. Seasonal multipliers are **shopkeeper-editable**, not learned — the shopkeeper knows their own Eid demand better than a model trained on a few months of data.

## Technical terms specific to this codebase

| Term | Meaning |
|---|---|
| **Event** | An immutable fact appended to the log. The only thing ever written. |
| **Fold** | A pure function replaying events into state. `fold(events) → LedgerState`. |
| **Projection** | A derived cache table, droppable and rebuildable from the log. Never a source of truth. |
| **HLC** | Hybrid logical clock. The ordering key, because device wall clocks are unreliable. |
| **Anomaly** | A semantic conflict detected after the fold (negative balance, suspected duplicate). Surfaced to the shopkeeper; never auto-resolved. |
| **Aging** | Grouping outstanding balances by how long they have been outstanding. Requirement 7, within-shop version. |
| **Intermittent demand** | A demand series with zero on most days. The normal case for shop SKUs, and why MAPE is the wrong metric. |
| **ADI / CV²** | Average demand interval and squared coefficient of variation. Used to classify SKUs and route them to the right forecasting method. |
| **FEFO** | First-expire-first-out. Batch consumption order. Deferred past v2 core. |
