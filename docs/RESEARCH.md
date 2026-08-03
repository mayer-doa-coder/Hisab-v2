# RESEARCH.md

**Owner:** B (collection, annotation, related work) and A (baselines, benchmarks, evaluation tables)

This repository backs an undergraduate research paper. This file is the protocol. `AGENTS.md` §9 is the short version that AI agents must follow.

---

## 1. The one rule

**Every quantitative claim in the paper has a row in `research/claims.csv` pointing at the file, experiment, or log that produced it. No row, no claim.**

This exists because v1's draft abstract opened with "670 million informal retail transactions occur daily in South and Southeast Asia" with no source, and asserted that snarkjs implements Bulletproofs when it implements Groth16, PLONK, and FFLONK. Both would be serious problems in review — the second is a factual error a reviewer in the area would catch immediately, and the first is a research-integrity question.

Never invent a citation, a statistic, or a benchmark number. If you do not know, write `[VERIFY]` and move on.

---

## 2. Chosen contribution

**Primary — a code-switched Bangla-English transactional command dataset and benchmark.**

The gap: there is substantial code-mixed Bangla work (TB-OLID, BnSentMix, BanglishRev, SentMix-3L / EmoMix-3L / OffMix-3L) but nothing found on transactional **intent + slot filling**. That is a structurally different problem — it needs slot extraction (person, amount, quantity, unit, date) over Bengali *and* Arabic numerals, with Banglish transliteration variation, and person names that are out-of-vocabulary by construction.

Why it fits this project: collection starts in Phase 0 and runs in parallel with all engineering, so it does not depend on the app being finished. It serves requirements 3 and 10 directly, so the research and the product are the same work. And dataset papers are the most reliably publishable first paper — unambiguous contribution, standard evaluation, reusable artifact.

**Secondary — on-device intermittent-demand forecasting for Bangladeshi kirana SKUs.** Comes nearly free: once Phase 4 ships to the pilot shops, sales data accumulates automatically and the benchmark harness is Phase 5 work already planned.

---

## 3. Pilot depth vs dataset breadth

These are different resources acquired in different ways, and confusing them is the most common planning error here.

| | Pilot | Utterance collection |
|---|---|---|
| What it needs | A relationship. Software on someone's phone for months. | 20 minutes at a counter. |
| Realistic scale | 4-5 shops | 60+ shopkeepers |
| What it produces | Sales history, telemetry, field observations | The dataset |

Target: **60 shopkeepers × ~40 utterances ≈ 2,400.** The 4-5 pilot shops are a subset, not the ceiling.

---

## 4. Utterance collection protocol

- [ ] Consent in Bengali, verbal for the short session, written for the pilot. Recorded. Withdrawable.
- [ ] Prompt with **situations, not sentences.** "A regular customer takes 2 kg of rice and says he'll pay Friday — how would you tell the phone to write that?" Never read them a sentence to repeat; that produces read speech, not natural speech.
- [ ] Record in the shop, with ambient noise. Noise is signal — it is the deployment condition.
- [ ] Capture metadata: shop type, district, approximate age band, gender, whether they use a smartphone daily. No names.
- [ ] **Collect from real shopkeepers. Never synthesise utterances yourself or with an LLM.** Reviewers will ask, and synthetic data would undermine the entire contribution.
- [ ] Two annotators, independently, on an overlapping subset. Report inter-annotator agreement (Cohen's κ per slot type).
- [ ] Release under CC-BY on Hugging Face, with a datasheet.

### Annotation schema (draft — revise after the first 100)

```
intent:  CREDIT_GIVEN | PAYMENT_RECEIVED | SALE | STOCK_QUERY | BALANCE_QUERY | OTHER
slots:   person, amount, currency_unit, quantity, quantity_unit, product, date
script:  bengali | latin | mixed
```

---

## 5. Baselines

Do not skip any of these. A dataset paper is judged on the quality of its benchmark.

| Model | Why |
|---|---|
| BanglaBERT | The standard Bangla baseline |
| BanglishBERT | Trained for exactly this code-mixed setting |
| mBERT | The generic multilingual floor |
| MuRIL | Strong on Indic + transliteration |
| XLM-R | The standard multilingual comparison |
| A multilingual LLM, zero-shot and few-shot | Reviewers will ask. Answer before they do. |
| Rule-based / regex | The honest floor. If a regex gets 80% of intents, say so. |

Report per-intent F1 and per-slot F1 separately. Aggregate numbers hide the interesting failures, and the interesting failure here is out-of-vocabulary person names.

---

## 6. Forecasting benchmark (secondary contribution)

Baselines: naive, SES, Croston (1972), SBA, TSB, a Markov state model over (demand state × stock state), EMA.

Route SKUs by ADI / CV² (the Syntetos-Boylan-Croston quadrant) rather than applying one method to everything.

**Metrics: MASE and RMSSE. Never MAPE** — it is undefined when the actual is zero, which is most days for intermittent demand.

**The differentiator is the on-device angle.** Report model size in KB, inference latency in ms on a real budget phone, and battery cost. That framing is genuinely underexplored and it is what makes this more than a re-run of known baselines.

**Be explicit that 4-5 shops is a small sample.** Reviewers accept honest small-N far more readily than inflated claims. Mitigate by running longer — there is no deadline.

---

## 7. Reading protocol

**Three passes.** Pass 1: title, abstract, figures, conclusion — 5 minutes, decide whether to continue. Pass 2: full read skipping proofs — 45 minutes, fill the extraction table. Pass 3: only the 3-5 papers you will actually build on — reproduce the equations and the evaluation setup. Most papers should stop at pass 1.

**The extraction table** lives at `research/literature/extraction.csv`. The **Limitations** column is the most valuable one and the one most people skip. Authors state their own weaknesses in the final section; that is a curated list of open problems, and a contribution very often lives in someone else's limitations paragraph.

**The two-hour reproduction test.** Before adopting any method, spend two hours trying to run the authors' code or reimplement the simplest version on toy data. If you cannot get a baseline running in two hours, either the paper is under-specified or the method is too complex for this timeline. Either way you learned it cheaply — and you learned it *before* committing.

**Search the technical problem, not the product.** `"Hisab app Bangladesh"` returns nothing. `"intermittent demand" Croston retail`, `code-mixed Bangla intent slot filling`, and `offline-first replication invariant financial` return the actual literature.

Sources in priority order: Google Scholar (use "Cited by" aggressively), ACL Anthology, arXiv (not peer reviewed — check whether it was ever published), IEEE Xplore, ACM DL, Semantic Scholar, Connected Papers / Research Rabbit for citation-neighbourhood maps. For local context and MSME statistics: BUET / BRAC / DU / NSU institutional repositories, a2i, BIGD, the ICT Division, and the SME Foundation.

---

## 8. Paper into code

**Implement the baseline before the improvement.**

1. Reimplement the paper's baseline in `packages/domain/` as a pure function
2. Write a test reproducing the paper's reported number on the paper's data. If you cannot reproduce it, you do not understand the method yet — stop here
3. Run the baseline on our data. Record it. **This is the floor.**
4. Only now implement the modification
5. Compare against the floor, on our data, same metric
6. **Anything that does not beat the floor gets deleted from the repository**

Step 6 is what prevents v1 recurring. v1 shipped a weighted ensemble of logistic regression, a Markov posterior, and an EMA signal with no evidence it beat any single component.

---

## 9. Venues

Start at **ICCIT** — IEEE Bangladesh Section, IEEE Xplore indexed, historically around 31% acceptance. For the dataset paper specifically, the **BLP (Bangla Language Processing) workshop**, which has co-located with EMNLP, is the better topical fit. ICISET, ICEEICT, and NSysS are reasonable second options. Extended versions go to IEEE Access or a journal afterwards.

**Verify deadlines yourself** at the official site each cycle. Do not rely on a remembered date.

**Avoid predatory venues.** Check: IEEE or ACM sponsorship; a named technical programme committee with real affiliations; past proceedings actually present in IEEE Xplore or the ACM DL. If the site emphasises fees and certificates over review, walk away. A predatory publication is worse than none.

---

## 10. Ethics

- [ ] University ethics / IRB approval started in Phase 0 — it can take weeks
- [ ] Consent forms in Bengali, for both the short utterance sessions and the pilot
- [ ] No personal identifiers in the released dataset
- [ ] Pilot participants can withdraw and have their data deleted

**Cross-shop credit sharing belongs in Future Work, with the harms analysis.** A section explaining that the scope was deliberately limited to within-shop because a cross-shop defaulter registry would function as an unlicensed credit bureau operating on data subjects who never consented, with no dispute mechanism, targeting a population for whom informal credit is often the only credit — that is a **strength**. It shows the consequences were thought through. The version that proposes cross-shop scoring without engaging the harms is the one that gets rejected.

---

## 11. Tooling

- **Zotero**, browser connector, BibTeX export into the LaTeX project. Never type a citation by hand. Never cite a paper you have not opened.
- `research/claims.csv` — every quantitative claim → its evidence
- `research/literature/extraction.csv` — one row per paper
- `research/field-notes/` — one file per shop visit, dated
