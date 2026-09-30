# FieldBridge: Integration Readiness Workbench

An interview prototype. It helps an integration analyst turn a lender's requirements and data dictionary into a
traceable, tested and human-approved integration brief.

> **AI interprets messy requirements and proposes mappings. Deterministic code performs checks and
> transformations. A person makes the final decision.**

Everything here is fictional: the customer (Northstar Lending), the requirements and the data. This is not an
Experian product. It has no access to Experian systems and has not been tested against Experian data. It prepares
and validates data mappings before they are connected to a decisioning system. It makes **no** lending or credit
decisions.

---

## Setup and run

Requires Python 3.11 or later (tested with 3.13).

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/streamlit run app.py
```

Open http://localhost:8501. No API key is needed. The app starts in **Demo mode**.

Run the tests:

```bash
.venv/bin/python -m pytest
```

### Optional: live AI mode

```bash
export OPENAI_API_KEY=sk-...          # never commit this
export OPENAI_MODEL=gpt-5-mini        # optional; this is the default
.venv/bin/streamlit run app.py
```

Then choose **Live AI** on the Upload step before generating proposals. The request uses the official OpenAI SDK
(`client.responses.parse`) with a strict structured-output schema (`MappingBatch` in `models.py`).

The app falls back to Demo mode, with a one-line notice, whenever:

- no key is set,
- the request fails, or
- the response fails validation (schema errors, unknown or duplicate target fields, a missing target).

Only field names, types, descriptions and units are sent to the model. **Sample values are withheld.** The model
doesn't need record-level data to propose a mapping, and deterministic code runs the samples locally.

---

## Workflow

| Step | What happens |
|---|---|
| **1. Upload** | Load a `.txt` requirements document and a `.csv` data dictionary, or click **Use fictional sample**. Each file card shows its name, type, what was detected, the parse status, and a Replace option. Malformed files show a clear error instead of crashing the app. |
| **2. Map and review** | One proposal per required target field, riskiest first. Selecting a row opens the **evidence panel**: the exact requirement passage (verified verbatim), source and target definitions, the transformation, a before-and-after sample preview, the AI's reasoning and assumptions, and the rule results. From there you can approve, reject or correct the mapping. **Review next issue** cycles through unresolved mappings. |
| **3. Validate** | Ten deterministic checks per mapping, one row per check: status, what was checked, the evidence or sample used, and a remediation. Below that is an initial test plan generated from templates attached to each transformation. |
| **4. Approve and export** | Record decisions, resolve or add open questions, view the audit history and download the Markdown brief. You can export unresolved work, but the brief is then prominently marked **NOT READY FOR BUILD**. |

### Status rules

- **Missing** and **Blocked** come only from deterministic checks.
- **Review required** comes from a check needing confirmation, a transformation with built-in assumptions, stated
  assumptions, or the AI flagging the mapping. The AI can ask for review, but it cannot clear a check, block a
  mapping or approve one.
- **Ready** means every check passed and the mapping awaits sign-off.
- **Approved** is set only by the reviewer. It is only possible when the mapping is not Missing or Blocked.
- **Rejected** mappings become Blocked until the reviewer corrects them. Editing an approved mapping resets it to
  Pending.

### The ten checks (`rules.py`)

1. A source field is present.
2. The source field exists in the uploaded dictionary.
3. Source and target data types are compatible, including transformation input and output types.
4. The transformation is in the approved registry.
5. The evidence quote appears verbatim in the uploaded document.
6. Units and currencies are compatible after the transformation.
7. Gross and net income are not treated as equivalent.
8. The transformation runs against the dictionary's sample value.
9. Missing consent data is not filled from the application submission time.
10. Human approval has been recorded.

---

## Project structure

| File | Responsibility |
|---|---|
| `app.py` | Streamlit interface and navigation |
| `models.py` | Pydantic models: AI contract (`MappingBatch`, `MappingProposal`), working mapping, audit event, target fields |
| `inputs.py` | `.txt` and `.csv` parsing with error handling |
| `mapping_engine.py` | Live OpenAI request, response validation and Demo-mode fallback |
| `transformations.py` | Approved transformation registry: plain Python functions plus test-plan templates |
| `rules.py` | The ten deterministic readiness checks and status derivation |
| `review.py` | Session workspace, reviewer actions (each writes an audit event), risk ordering, test plan |
| `exporter.py` | Markdown integration brief |
| `sample_requirements.txt`, `sample_data_dictionary.csv` | Fictional inputs |
| `sample_mappings.json` | Saved, schema-valid AI response used by Demo mode |
| `demo_extras/data_dictionary_v2_with_consent.csv` | Optional second dictionary with a consent field, a net-income field and a EUR field |
| `tests/` | Focused pytest suite |

The model **selects** a transformation identifier. Trusted code performs the transformation. There is no `eval`,
no `exec`, no dynamic import and no generated code.

---

## Expected sample results

| Target | Source | Transformation | Sample | Initial status |
|---|---|---|---|---|
| `consent_timestamp` | none | `none` | — | **Missing** (listed first) |
| `monthly_gross_income_gbp` | `annual_gross_income_gbp` | `annual_to_monthly` | 48000 → 4000 | Review required |
| `applicant_age_years` | `date_of_birth`, `submitted_at` | `calculate_age_at_submission` | 1992-04-17 at 2026-09-01 → 34 | Review required |

---

## Three-minute interview demonstration

1. **Upload (20 s).** Click **Use fictional sample**. Point out the file cards: 3 requirements and 3 fields
   detected, both parsed. Also point out the target-field table. Keep **Demo mode** selected and click
   **Generate mapping proposals**.
2. **Risk-first review (60 s).** `consent_timestamp` is at the top and **Missing**. In the evidence panel, show
   the exact R3 passage with its *Found verbatim, line 5* marker and the AI's reasoning. Then open the
   **Correct mapping** tab and pick `identity` with `submitted_at`. The preview immediately shows **Blocked**
   (check 9): submission time is not consent time. The deterministic rule overrides a plausible-looking mapping.
   Apply the correction to show it's audited, then set the transformation back to `none`.
3. **Human approval (40 s).** Click **Review next issue** to reach `monthly_gross_income_gbp`. Show 48000 →
   4000, the gross/gross and GBP/year → GBP/month checks, and the explicit assumptions. Click **Approve mapping**:
   the status becomes Approved and the row moves to the bottom. Optionally show that `applicant_age_years`
   gives 34.
4. **Validate (30 s).** Show the ten-row check table for one mapping, then the test plan. Point out the
   birthday-boundary, leap-day and UTC-midnight cases, which come from templates, not from the AI.
5. **Export (30 s).** On step 4, the banner reads **Not ready for build**. Show the open question from the AI and
   the one raised by the rule checks, and the audit history listing your edits and the approval. Download the
   brief and open it: it is marked NOT READY and keeps every open question.

Talking points: every status can be traced to a named check. The model's output is schema-validated and treated
as a proposal. The person has the final say, and every action is audited.

**Optional extension.** Replace the dictionary with `demo_extras/data_dictionary_v2_with_consent.csv` and
regenerate. Map `consent_timestamp` to `consent_given_at` using `identity`: every check passes and it can be
approved. Try `monthly_net_income_gbp` (Blocked by the gross/net check) or `annual_gross_income_eur` (Blocked by
the currency check).

---

## Known limitations

- Session-only state. There is no persistence, no authentication, and the actor is always "Demo reviewer".
- Only `.txt` and `.csv` inputs are supported. Requirement IDs are detected with an `R1:`-style pattern; other
  documents fall back to one requirement per line (`P1`, `P2`, …).
- Semantic checks (gross vs net, submission time, units and currency) use keyword and unit-string heuristics. They
  catch the known failure modes in the sample but are not exhaustive. A production system would use a governed
  field-semantics catalogue.
- Checks run against one sample value per field, not a representative dataset.
- Demo mode replays a saved response built for the fictional sample. With other files it still loads, and the rule
  checks flag anything that doesn't fit, but new mappings need live AI or manual correction.
- The live AI path is unit-tested with a stubbed client but has not been run against the real API in this build,
  because no key was available.
- Age uses the UTC calendar date of `submitted_at`, and a 29 February birthday is treated as reached on 1 March in
  non-leap years. Both are surfaced as assumptions for confirmation.
- `annual_to_monthly` does not round. The expected precision is raised as an assumption.
