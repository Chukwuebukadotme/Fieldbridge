# FieldBridge: Integration Readiness Workbench

An interview prototype. It helps an integration analyst turn a lender's requirements and data dictionary into a
traceable, tested and human-approved integration brief.

> **AI interprets messy requirements and proposes mappings. Deterministic code performs checks and
> transformations. A person makes the final decision.**

Everything here is **demo data**: the customer (Northstar Lending), the requirements and the records are not real.
This is not an Experian product. It has no access to Experian systems and has not been tested against Experian
data. It prepares and validates data mappings before they are connected to a decisioning system. It makes **no**
lending or credit decisions.

Built with Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4 and zod, with the official OpenAI and
Anthropic SDKs.

---

## Setup and run

Requires Node.js 20 or later.

```bash
npm install
npm run dev          # http://localhost:3000
```

For a production build: `npm run build && npm start`.

Run the tests:

```bash
npm test             # Vitest: transformations, rules, export, parsing, AI fallback
```

No API key is needed. The app starts in **Demo mode**.

### Use your own AI key (optional)

Click the engine button in the top-right corner (it reads **Demo mode**) to open **AI settings**:

1. Choose **OpenAI** or **Anthropic**.
2. Paste your API key. Optionally click **Verify key**; this lists your models, is free and generates nothing.
3. Pick a model:
   - OpenAI: GPT-5 mini (the default) or GPT-5.
   - Anthropic: Claude Opus 5.5 (the default), Sonnet 5.5 or Haiku 4.5.
   - Either provider: any other model ID you type in.
4. Back on **Upload**, click **Generate mapping proposals**.

How a pasted key is handled:

- It lives only in the browser tab's memory, and refreshing or closing the tab clears it.
- It is sent over HTTPS with each request to the app's own `/api/propose` route, which forwards it to the
  provider for that one call.
- It is never stored, logged, or written to the audit history or the brief.
- Error messages are built from HTTP status codes, never from provider text, because some provider errors echo
  part of the key.

You can also set `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` on the server. A pasted key takes precedence. Don't set
these on a public deployment: anyone with the link could then spend your credit.

What gets sent to the model: the requirements text, and each dictionary field's name, type, description and unit.
**Sample values are withheld.** The model doesn't need record-level data to propose a mapping, and deterministic
code runs the samples locally.

The model's output is checked twice: on the server, then again in the browser. Both use a strict zod schema
(`MappingBatch`) plus structural checks (every target covered once, no unknown targets, `Approved` never allowed).
Anything malformed, a rejected key, or any other failure shows a one-line notice and continues in Demo mode.

- **OpenAI:** Responses API (`client.responses.parse` with `zodTextFormat`).
- **Anthropic:** Messages API structured outputs (`client.beta.messages.parse` with `betaZodOutputFormat`) at
  medium effort. On Opus 5.5 and Sonnet 5.5 it enables the server-side refusal fallback (`fallbacks: "default"`),
  so a declined request is retried on a recommended fallback model.

---

## Workflow

| Step | What happens |
|---|---|
| **1. Upload** | Drop or browse for a `.txt` requirements document and a `.csv` data dictionary, or click **Use demo data**. Each file card shows its name, type, origin, what was detected, the parse status, a preview, and Replace and Remove actions. Malformed files show a clear error instead of crashing the app. Choose the mapping engine here: Demo mode, OpenAI or Anthropic. |
| **2. Map and review** | One proposal per required target field, riskiest first. Selecting a row opens the **evidence panel**, with three tabs. **Evidence:** the exact requirement passage (verified verbatim), source and target definitions, the transformation, a before-and-after sample preview, the reasoning and the assumptions. **Rule checks:** all ten results. **Correct mapping:** change the transformation, sources or requirement, and see the resulting status before you save. Approve and Reject sit at the bottom of the panel. **Review next issue** cycles through unresolved mappings. Keyboard: `↑` `↓` to move, `N` for the next issue, `A` to approve. |
| **3. Validate** | Ten deterministic checks per mapping. Each row expands to show the evidence or sample used and the remediation. Below that is an initial test plan generated from templates attached to each transformation. |
| **4. Approve and export** | Record decisions, resolve or add open questions, and read the audit history. Download, copy or preview the Markdown brief. You can export unresolved work, but the brief is then prominently marked **NOT READY FOR BUILD**. |

The stepper at the top is clickable once proposals exist. Changing input files or clicking **Start over** offers
**Undo**, so review work is never lost by accident.

### Status rules

- **Missing** and **Blocked** come only from deterministic checks.
- **Review required** comes from a check needing confirmation, a transformation with built-in assumptions, stated
  assumptions, or the AI flagging the mapping. The AI can ask for review, but it cannot clear a check, block a
  mapping or approve one.
- **Ready** means every check passed and the mapping awaits sign-off.
- **Approved** is set only by the reviewer. It is only possible when the mapping is not Missing or Blocked.
- **Rejected** mappings become Blocked until the reviewer corrects them. Editing an approved mapping resets it to
  Pending.

### The ten checks (`lib/rules.ts`)

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

| Path | Responsibility |
|---|---|
| `app/page.tsx`, `app/layout.tsx`, `app/globals.css` | Page shell, fonts, theme |
| `app/api/propose/route.ts` | Calls the chosen provider with the caller's key; validates output before returning |
| `app/api/verify-key/route.ts` | Free key check (lists models) |
| `app/api/status/route.ts` | Reports whether server-side keys exist (booleans only) |
| `components/workbench/*` | The four steps, evidence panel, AI settings drawer, toasts, state |
| `components/ui.tsx` | Buttons, status badges (icon plus text, never colour alone), cards, tabs |
| `lib/models.ts` | Types, target fields, and the zod AI contract (`MappingBatch`, `MappingProposal`) |
| `lib/inputs.ts` | `.txt` and `.csv` parsing with strict UTF-8 and clear errors |
| `lib/transformations.ts` | Approved transformation registry: plain functions plus test-plan templates |
| `lib/rules.ts` | The ten deterministic readiness checks and status derivation |
| `lib/review.ts` | Workspace, pure reviewer actions (each writes an audit event), risk ordering, test plan |
| `lib/exporter.ts` | Markdown integration brief |
| `lib/engine.ts` | Client-side generation: Demo mode, or a live request with validation and fallback |
| `lib/ai/*` | Provider-neutral prompt and validation; OpenAI and Anthropic adapters; server helpers |
| `public/demo/*` | Demo requirements, dictionary, dictionary v2, and the saved Demo-mode response |
| `tests/*` | Vitest suite |

The model **selects** a transformation identifier. Trusted code performs the transformation. There is no `eval`,
no `new Function`, no dynamic import and no generated code.

---

## Expected demo results

| Target | Source | Transformation | Sample | Initial status |
|---|---|---|---|---|
| `consent_timestamp` | none | `none` | — | **Missing** (listed first) |
| `monthly_gross_income_gbp` | `annual_gross_income_gbp` | `annual_to_monthly` | 48000 → 4000 | Review required |
| `applicant_age_years` | `date_of_birth`, `submitted_at` | `calculate_age_at_submission` | 1992-04-17 at 2026-09-01 → 34 | Review required |

---

## Three-minute interview demonstration

1. **Upload (20 s).** Click **Use demo data**. Point out the file cards (3 requirements and 3 fields detected, both
   parsed), the target-field table and the engine choice. Click **Generate mapping proposals**.
2. **Risk-first review (60 s).** `consent_timestamp` is at the top and **Missing**. In the evidence panel, show the
   exact R3 quote with its *Found verbatim, line 5* marker. Open **Correct mapping**, then pick `identity` with
   `submitted_at`. The panel immediately shows **If applied: Blocked** (check 9), before anything is saved:
   submission time is not consent time. Apply it to show it's audited, then set the transformation back to
   `none`.
3. **Human approval (40 s).** Press `N` (or click **Review next issue**) to reach `monthly_gross_income_gbp`. Show
   48000 → 4000, the source → target definitions and the assumptions. Press `A` (or click **Approve mapping**): the
   status becomes Approved and the row moves to the bottom.
4. **Validate (30 s).** Click **Validate** in the stepper. Expand a check, then scroll to the test plan: the
   birthday-boundary, leap-day and UTC-midnight cases come from templates, not the AI.
5. **Export (30 s).** On step 4 the banner reads **Not ready for build**. Show the AI's open question alongside the
   rule-raised one, and the audit history of your edits and the approval. Click **Preview**, then **Download**: the
   brief is marked NOT READY and keeps every open question.

**Optional: live AI.** Open AI settings, pick Anthropic or OpenAI, paste a key, verify it and regenerate. Point out
that the same checks and approvals apply to the live proposals. A wrong key shows a clean notice and falls back to
Demo mode.

**Optional: updated dictionary.** On Upload, click *Try the updated demo dictionary (v2)* and regenerate. Map
`consent_timestamp` to `consent_given_at` using `identity`: every check passes and it can be approved. Then try
`monthly_net_income_gbp` (Blocked by the gross/net check) or `annual_gross_income_eur` (Blocked by the currency
check).

---

## Known limitations

- State lives in one browser tab. There is no persistence and no authentication, and the actor is always "Demo
  reviewer".
- Only `.txt` and `.csv` inputs up to 1 MB are supported. Requirement IDs are detected with an `R1:`-style
  pattern; other documents fall back to one requirement per line (`P1`, `P2`, …).
- Semantic checks (gross vs net, submission time, units and currency) use keyword and unit-string heuristics. They
  catch the known failure modes in the demo data but are not exhaustive. A production system would use a
  governed field-semantics catalogue.
- Checks run against one sample value per field, not a representative dataset.
- Demo mode replays a saved response built for the demo data. With other files it still loads, and the rule
  checks flag anything that doesn't fit, but new mappings need live AI or manual correction.
- Live AI has been exercised end to end with an invalid key (a clean 401 notice, then Demo mode) and with stubbed
  responses in tests. A successful live call has not been run in this build, because no valid key was available.
- `/api/propose` is public on a deployment. It only works with the caller's own key unless server keys are set,
  and there is no rate limiting.
- Age uses the UTC calendar date of `submitted_at`, and a 29 February birthday is treated as reached on 1 March in
  non-leap years. Both are surfaced as assumptions for confirmation.
- `annual_to_monthly` does not round. The expected precision is raised as an assumption.
