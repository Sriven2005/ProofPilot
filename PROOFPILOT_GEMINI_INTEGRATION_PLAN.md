# ProofPilot Gemini Evaluator Integration Plan

**Status:** Planning only. No application, assessment, UI, styling, or database files were changed for this phase. The only file created for this request is this report.

**Planning basis:** Repository inspection and official Gemini API / Supabase documentation checked on 2026-11-08. Gemini pricing, model availability, free-tier availability, and quotas can change; verify the linked current pages and the actual Google AI Studio project limits immediately before implementation.

## 1. Existing architecture findings

### SQL submission flow

- The React client calls `evaluateSqlAnswer(answer, challengeId)` in `src/lib/sqlClient.ts`, posting JSON to `POST /api/evaluate/sql`.
- `src/server/sqlEvaluatorPlugin.ts` installs that route through Vite's `configureServer` and `configurePreviewServer` hooks. It currently accepts only `analyst-sql-retention`, parses the submission, and invokes a Python SQLite subprocess.
- The Python runner is `src/server/sqlite_sandbox.py`. Phase 2 documents an in-memory SQLite database, hidden controlled fixtures and verifier checks, request/section/output/time limits, and SQLite restrictions. It explicitly is not an OS sandbox/container and has no hard memory/job-object limit.
- `src/lib/sqlEvaluation.ts` combines deterministic SQL verification with local reasoning evaluation and the essential-failure cap. The assessment flow sends the resulting existing `Evaluation` type through normal assessment persistence/report generation.
- This Vite middleware exists in local development and Vite preview; a static `vite build` does not deploy this API. It is not a suitable public execution service for untrusted candidate SQL.

### Deterministic and provider evaluators

- Deterministic SQL checks are implemented in `src/lib/sqlEvaluation.ts`; this includes schema and constraint checks, controlled query output checks, findings, weighted criteria, and the Phase 2 essential gate.
- The general evaluator in `src/lib/evaluation.ts` remains the local rubric path for non-SQL challenges. Phase 2 did not replace that path with an LLM.
- `src/lib/technicalEvaluatorProvider.ts` defines a generic server-side transport/provider boundary and parses a five-criterion structured result. It has no Gemini network adapter, API key, server route, timeout/retry policy, or production caller.
- The current provider parser reattaches verifier facts from the request rather than accepting model-supplied facts, which is a useful invariant. Before live use, server policy must also reconcile model claims with verifier facts and constrain model scores when required deterministic tests fail. Type-shape validation alone does not do that.

### Vite endpoint limitations

`vite.config.ts` registers `sqlEvaluatorPlugin()` as a Vite plugin. That is a development/preview integration mechanism, not an application backend deployment target. The SQL worker launches Python with `spawn()`; Supabase Edge Functions run in a Deno-compatible runtime and should not be assumed to support this Node child-process execution pattern. The reported SQL containment does not meet the stated requirement for a hardened public untrusted-code sandbox.

### Benchmark and test architecture

The repository contains:

- `tests/benchmarks/sqlRetailBenchmark.ts`: original 20 SQL cases.
- `tests/benchmarks/sqlHoldout.ts`: an exposed 10-case regression set used during tuning; it is not an untouched holdout.
- `tests/benchmarks/sqlBlindHoldout.ts`: eight blind holdout cases.
- Test scripts `test:benchmark`, `test:regression`, `test:sql-blind-holdout`, `test:sql-workflow`, and `test:evaluator` in `package.json`.
- Phase 2 report `PROOFPILOT_EVALUATOR_PHASE2.md` records original benchmark results after changes: 20/20 ran; MAE 11.10; 9/20 (45%) within ±5; 12/20 (60%) within ±10; 8 cases differed by more than 10; invalid-category answers scoring at least 70: zero. It reports all eight blind cases ran once after the deterministic policy was frozen, with no false positives or false negatives under the report's stated thresholds. Those manually authored references are provisional and the small holdout is not an accuracy claim.

Gemini must be evaluated against these deterministic results and references; it must not be presumed superior. Preserve current suites as frozen baselines and maintain a separate future holdout.

### Supabase configuration

The user previously provided a Supabase project URL for `proofpilot`, but repository inspection found no `supabase/` project directory, Supabase npm dependency, Edge Function, Supabase environment variable reference, schema/migration, or local Supabase configuration. That means the hosted project exists by user-provided context, but this repository is not currently connected/configured for it. No environment-file contents or secrets were read or displayed.

## 2. Recommended backend architecture

### Recommendation

Use Supabase Edge Functions as a narrow authenticated API/orchestration layer for Gemini evaluation and, later, scenario generation and adaptive follow-ups. Keep evaluation and candidate data access behind server-side authorization. Keep the deterministic verifier authoritative for executable facts. Do not run arbitrary SQL/Python in an Edge Function; use a separately deployed, ephemeral, isolated execution worker/service with explicit CPU, memory, wall-clock, filesystem, network, and concurrency limits. The Edge Function should call that worker with a short-lived authenticated request, receive a bounded evidence object, then call Gemini with the challenge and verified evidence.

Supabase documents Edge Functions as suitable for small AI inference and third-party API orchestration. Its current hosted limits include 256 MB memory, 2 seconds CPU time per request, and maximum wall time of 150 seconds on Free / 400 seconds on paid plans. These limits favor orchestration and external network I/O, not a general-purpose untrusted-code sandbox. See [Supabase Edge Functions](https://supabase.com/docs/guides/functions), [Edge Function limits](https://supabase.com/docs/guides/functions/limits), and [CPU limit guidance](https://supabase.com/kb/troubleshooting/edge-function-cpu-limits).

### Suitability by use case

| Function | Edge Function fit | Recommended handling |
|---|---|---|
| Candidate evaluation | Good for authenticated request validation, reading challenge/rubric, orchestration, calling Gemini, validating response and returning feedback. | One evaluation endpoint; a server-side deterministic policy remains final authority. |
| Scenario generation | Suitable for bounded, on-demand generation. Generated content must pass schema, rubric completeness, role/difficulty checks, content-safety checks, and human review before becoming selectable. | Separate function and quotas; persist approved scenarios only after review. Do not expose hidden rubrics or answer keys to candidates. |
| Adaptive follow-up questions | Suitable for short requests when based only on prior answer, challenge rubric, and evidence; avoid long-running conversational agent loops. | Separate endpoint, strict count/length budget, generated question is rubric-linked, and do not leak expected answers. |
| SQL execution | Poor fit for direct execution. Deno Edge Functions are not a drop-in for the current Node `spawn()` + Python subprocess architecture, and hosted CPU/memory limits are not OS isolation. | External sandbox worker or managed isolated execution service. Edge function only orchestrates. |

Supabase notes that Edge Functions are Deno-compatible, can call external services, and can suffer cold starts; heavy/long-running work belongs in a worker. [Supabase Edge Functions overview](https://supabase.com/docs/guides/functions).

### Request lifecycle

1. Browser submits challenge ID and candidate response to the authenticated Edge Function; no API key or hidden evaluation data comes from the browser.
2. Function verifies caller JWT, assessment ownership/access, request size, allowed challenge, and server-side rate limits.
3. Server loads the authoritative challenge definition and private rubric. Do not trust client-provided rubric/weights.
4. For SQL, submit SQL sections to the isolated worker with a challenge-scoped dataset and test suite. The worker returns bounded structured execution facts. It never receives Gemini credentials.
5. Build a versioned Gemini request from challenge text, hidden rubric, required deliverables, candidate answer, verifier facts, test failures, and policy instructions.
6. Call Gemini server-to-server with a deadline, bounded output tokens, retry only on transient errors, and a request/correlation ID. Never include candidate identifiers or unrelated personal data.
7. Validate response against a strict schema, then reconcile it with deterministic facts. Hard verifier failures are immutable. Apply the documented score combination/caps server-side.
8. Return the final typed assessment response to the browser. Persist only after explicit product data-retention decisions and authorization policies exist; this plan does not create tables or migrations.

## 3. Gemini evaluation contract

### Input schema (conceptual, server to model)

The provider should receive a versioned, compact object similar to:

```json
{
  "contractVersion": "proofpilot-evaluation.v1",
  "challenge": {
    "id": "analyst-sql-retention",
    "role": "Data Analyst",
    "description": "Authoritative scenario and constraints",
    "requiredTasks": ["..."],
    "requiredDeliverables": ["..."],
    "hiddenRubric": [{"criterion": "Technical correctness", "weight": 25, "requirements": ["..."]}]
  },
  "submission": {
    "answer": "Candidate's submitted response",
    "sections": {"schema": "...", "sampleData": "...", "query": "...", "reasoning": "..."}
  },
  "verification": {
    "executed": true,
    "engine": "SQLite",
    "schemaFindings": ["..."],
    "testResults": [{"id": "orphan_order_rejected", "passed": false, "observed": "..."}],
    "syntaxOrExecutionError": null,
    "queryResultSummary": {"rowCount": 2, "expectedMatched": false},
    "factsAreAuthoritative": true
  },
  "policy": {
    "criterionWeights": {"problemUnderstanding": 15, "technicalCorrectness": 25, "reasoningAndApproach": 20, "practicalImplementation": 25, "validation": 15},
    "doNotInventExecutionFacts": true,
    "recognizeValidAlternatives": true
  }
}
```

Avoid disclosing hidden evaluation datasets or a complete model answer. Include only summarized query output needed to reason about correctness, with bounded result rows and redacted values where possible.

### Output schema (model JSON)

Use Gemini's structured-output JSON Schema mode, then validate independently in TypeScript at runtime. Structured output constrains shape but is not proof of factual accuracy; Gemini's documented implementation supports a subset of JSON Schema. [Gemini structured outputs](https://ai.google.dev/gemini-api/docs/structured-output).

```json
{
  "contractVersion": "proofpilot-evaluation.v1",
  "overallScore": 0,
  "criteria": [
    {
      "name": "Technical correctness",
      "weight": 25,
      "score": 0,
      "evidence": [{"quote": "Exact short excerpt", "finding": "..."}],
      "correctDecisions": ["..."],
      "incorrectDecisions": ["..."],
      "missingRequirements": ["..."],
      "explanation": "..."
    }
  ],
  "syntaxAndExecutionFindings": [{"findingId": "...", "source": "verifier", "statement": "..."}],
  "logicalMistakes": [{"evidence": "...", "explanation": "...", "severity": "major"}],
  "validAlternativeApproaches": [{"approach": "...", "whyValid": "..."}],
  "improvementRecommendations": ["..."],
  "confidence": {"overall": 0.0, "lowConfidenceCriteria": ["..."], "uncertainties": ["..."]}
}
```

Implementation requirements for this contract:

- Exactly five named criteria and fixed server-owned weights: 15/25/20/25/15 (total 100). Reject missing, extra, duplicate, non-finite, or out-of-range criterion scores and malformed output.
- Recompute weighted overall score server-side; ignore the model's `overallScore` as authoritative and either compare it for telemetry or omit it from the accepted server result.
- Evidence references must be short exact excerpts or section offsets from the candidate answer, or identifiers from actual verifier findings. Reject fabricated quotations/IDs where practical; do not present a model paraphrase as a verified fact.
- A model may explain verifier results but cannot change `passed`, syntax/execution error, schema facts, or expected-vs-observed output. Preserve verifier evidence as a separate field in the final result.
- Require the model to state valid alternatives and uncertainty when relevant. Empty arrays are acceptable if no evidence supports a claim.
- Run deterministic score gates after generation. Essential SQL failures stay capped at 49 (or lower according to the deterministic policy) even when prose is persuasive; model output cannot lift that cap.
- Keep reasoning score distinct from execution pass/fail. Define a documented blending rule before launch, e.g. criteria owned by deterministic verification remain deterministic, while the model may score interpretation/reasoning and add evidence-backed feedback; where a criterion combines both, enforce a deterministic ceiling. Do not average two overall scores blindly.

## 4. Security and data handling

- Make Gemini requests only from a server runtime. Google explicitly warns that keys embedded in browser code can be extracted and recommends a backend proxy/server-side calls. [Gemini API key security](https://ai.google.dev/gemini-api/docs/api-key).
- Never use `VITE_GEMINI_API_KEY`; Vite `VITE_*` variables are client build inputs. Use `GEMINI_API_KEY` only in Supabase Edge Function secret storage or another server secret manager. Never commit it or place it in `.env.example` with a real value.
- Supabase Edge Functions have server-side secrets and injected project keys. Current docs distinguish publishable keys from secret keys; secret/service-role keys bypass RLS and must never be sent to the browser. Prefer the caller's verified JWT and RLS-respecting client for candidate-owned operations. Use privileged access only for narrowly scoped admin work, if later justified. [Supabase secrets](https://supabase.com/docs/guides/functions/secrets), [Function security](https://supabase.com/docs/guides/functions/auth).
- Require authenticated user JWT for evaluation endpoints once Auth is enabled; reject anonymous calls or apply a deliberate abuse-control design if assessments are intentionally anonymous. Validate challenge IDs on the server; enforce user/assessment ownership and request/response byte limits.
- Add per-user and per-IP quotas, concurrency limits, Gemini model allowlist, short upstream timeout, bounded retry/backoff, circuit breaker, and maximum token/output budget. Do not let browser payload choose model name, rubric, or temperature/effort controls.
- Treat candidate text as untrusted prompt data. Delimit it as data; instruct the evaluator to ignore embedded directions; never grant the model tools, network access, database access, or verifier controls. Do not use prompt injection text as policy.
- Keep candidate code and SQL isolated from Gemini API key environment and database credentials. Do not log raw submissions by default. Log request ID, model/version, token usage, timing, outcome, score deltas, and validation failures with personal data minimized. Define retention/deletion and candidate consent before production.
- Do not send secrets, auth tokens, direct identifiers, or full hidden datasets to Gemini. Confirm Google API data-use terms/retention for the chosen tier before sending real candidate submissions.
- Do not store API keys in `src/`, Vite config, `localStorage`, browser session, or Supabase tables.

## 5. Benchmark integration and acceptance gates

### Evaluation protocol

1. Freeze the current deterministic evaluator build and record commit/hash, benchmark fixture version, and model ID/version.
2. For every original 20 case and every eight blind holdout cases, run the same verifier and capture the exact execution evidence once. Keep fixtures and expected results identical across deterministic and Gemini evaluation.
3. Submit each case to Gemini in isolated, stateless calls with no benchmark case ID and no reference score. Do not batch multiple candidate cases in a prompt because that enables leakage/comparison.
4. Run deterministic scoring, Gemini scoring, and documented provisional reference comparison separately. Record all three scores, criterion scores, exact verified failures, errors, token usage, latency, model version, and prompt/schema version.
5. Score deltas against the current deterministic evaluator and provisional expert reference. Report MAE, median absolute error, ±5/±10 rates, and severe false positives/false negatives. A high score on an invalid essential implementation is a serious false positive; a valid alternative incorrectly capped is a serious false negative.
6. Audit every disagreement >10 points and every invalid answer ≥70 or valid answer <50. Have an independent SQL evaluator review reference labels and ambiguous alternatives before treating them as ground truth. Keep disputed references marked provisional or as a score band.
7. Tune only against a development/tuning split. Preserve the existing eight blind cases unexposed after initial evaluation and create a fresh, independently authored unseen set for each significant prompt/model-policy iteration. Retire a holdout after it has influenced changes.
8. Re-run benchmark after prompt, model, verifier, or score-policy changes. Pin exact model ID (not a moving alias) for each experiment; record model retirement/migration. Do not state “90% accuracy” from these 28 authored cases.

### Benchmark scorecard

Produce separate tables for: original 20, eight blind holdout, and new unseen set. Each row should include case ID, validity category, deterministic score, Gemini score, reference score or band, absolute differences, essential verifier failures, Gemini acknowledgment status, false-positive/negative flag, model/schema versions, and token/cost usage.

Report:

- Gemini vs provisional reference: MAE and percentage within ±5 and ±10, with counts and denominator.
- Deterministic vs provisional reference using same metrics, so the model is compared fairly to the current baseline.
- Gemini vs deterministic evaluator, with disagreement distribution and manual audit of large deltas.
- Invalid essential solutions that Gemini would score at ≥70 before and after server-side caps; valid alternative solutions receiving unjustified penalties.
- Execution-fact contradictions: count of outputs that claim a failed verifier check passed, or invent an error/result.
- Schema failures, retries, timeouts, rate-limit errors, latency percentiles, and per-assessment API cost.
- Results separated by development/tuning, existing 20, existing 8 blind cases, and new unseen cases. No aggregate should conceal a weak subset.

**Release gate recommendation:** keep Gemini advisory/shadow-scored until independent review of the case references, zero material contradictions of execution facts, zero invalid-essential high-score false positives after deterministic caps, and acceptable unseen-case bands are demonstrated. Do not route real hiring decisions from an unreviewed model score.

## 6. Quota, model, and cost strategy

Google's current model catalog lists stable `gemini-3.8-flash` as an advanced Flash option and `gemini-3.5-flash-lite` as a lower-cost option; `gemini-3.1-pro-preview` is a higher-capability preview. Google currently recommends newer stable models for new projects and notes older 2.5 models are access-limited. Model IDs, capabilities, pricing, free eligibility and availability may change. See [Gemini models](https://ai.google.dev/gemini-api/docs/models).

The current rate-limit documentation says quotas are per Google Cloud project, vary by model and tier, and are evaluated across RPM, input TPM and RPD. Free tier and paid tier limits are not guaranteed fixed capacities; inspect the actual project limit page in AI Studio. [Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits).

### Prototype model choices (prices checked 2026-11-08)

| Model | Prototype role | Current paid text token price | Notes |
|---|---|---:|---|
| `gemini-3.8-flash` | Primary quality/latency candidate for technical review | Introductory through 2026-12-31: $0.75 / 1M input and $3.75 / 1M output; standard from 2027-01-01: $1.50 / 1M input and $7.50 / 1M output | Stable/GA according to current model page; structured output supported should be confirmed for selected API version. Introductory price expires soon. [Model announcement/pricing](https://ai.google.dev/gemini-api/docs/latest-model). |
| `gemini-3.5-flash-lite` | Lower-cost comparison / high-volume option | $0.30 / 1M input and $2.50 / 1M output | Stable; cheaper, but technical correctness must be benchmarked rather than assumed. [Pricing](https://ai.google.dev/gemini-api/docs/pricing). |
| `gemini-3.1-pro-preview` | Optional quality comparison on a small benchmark subset | $2 / 1M input and $12 / 1M output up to 200K input tokens; higher above that | Preview model and substantially more expensive; do not use as default without measured benefit. [Gemini 3 guide](https://ai.google.dev/gemini-api/docs/gemini-3). |

Pricing is USD per million tokens for standard synchronous text requests, excluding taxes, any platform charges, and possible changes. Gemini API Free Tier may be available for some models/projects, but it can have lower quotas and different data-use terms. The pricing page currently marks free token use for the listed Flash/Flash-Lite options, but that does not mean unlimited or guaranteed availability. Verify model-specific free eligibility and data-use settings before sending candidate information. [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [Gemini billing](https://ai.google.dev/gemini-api/docs/billing).

### Per-assessment estimate

Planning assumption: one final-review call per SQL submission; 6,000 input tokens (challenge + rubric + capped candidate answer + compact verifier evidence + instructions) and 1,500 output tokens (criterion feedback and recommendations). No grounding, images, retries, or adaptive follow-up call.

| Model | Estimate at current pricing | Estimate after 2027-01-01 where applicable |
|---|---:|---:|
| Gemini 3.8 Flash | ~$0.0101 per assessment at introductory pricing | ~$0.0203 at standard pricing |
| Gemini 3.5 Flash-Lite | ~$0.0056 per assessment | Same listed current rate; verify before use |
| Gemini 3.1 Pro Preview | ~$0.0300 per assessment (assuming ≤200K input tokens) | Verify current pricing at rollout |

Formula: `(inputTokens × inputUSDPerMillion + outputTokens × outputUSDPerMillion) / 1,000,000`. Candidate answers and reasoning traces vary widely; enforce server-side token ceilings and log actual usage. One final evaluation call is recommended for the MVP. Scenario generation and each adaptive follow-up are separate calls with separate budget ceilings; do not generate scenarios automatically on every assessment.

### Fallback behavior

- If Gemini is unavailable, times out, returns malformed JSON, exceeds quota, or fails schema validation: preserve deterministic verifier result and label model feedback unavailable; do not silently turn a local deterministic score into an “AI score.”
- During initial rollout, return deterministic evaluation as the canonical result and store Gemini output only in a clearly labeled shadow/diagnostic field (with user consent/data policy in place).
- After approval to use hybrid scores, use a deterministic fallback mode; never retry indefinitely, never drop deterministic failures, and never fabricate model explanations.
- Consider a second Gemini model only as an explicitly configured fallback with benchmarked behavior. Do not fan out to multiple models by default; this multiplies latency, cost, and data transfer.

## 7. Required environment variables

| Variable | Runtime | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | Supabase Edge Function secret only, or other server secret manager | Gemini Developer API credential. Never `VITE_GEMINI_API_KEY`. Never commit a value. |
| `GEMINI_MODEL` | Server-side deployment configuration | Pinned model ID per environment, e.g. chosen stable model. Validate against allowlist. |
| `SUPABASE_URL` | Edge Function runtime | Supabase project endpoint; injected by Supabase hosted runtime. |
| `SUPABASE_PUBLISHABLE_KEYS` / current single-key equivalent | Server runtime for user/RLS-respecting operations | Supabase public key input; injected by hosted function runtime. No service privilege. |
| `SUPABASE_SECRET_KEYS` | Server only, only if future narrowly scoped privileged function operation requires it | Supabase secret key set; it bypasses RLS. Prefer not to use it for candidate requests. Never expose to browser. |
| `SQL_WORKER_URL` | Edge Function secret/config | Private URL for the separate isolated SQL worker, if used. |
| `SQL_WORKER_TOKEN` | Edge Function secret only | Service-to-service authentication to worker; short rotation and narrow scope. |
| `EVALUATOR_MAX_INPUT_TOKENS`, `EVALUATOR_MAX_OUTPUT_TOKENS`, `EVALUATOR_TIMEOUT_MS` | Server config | Guardrails. Defaults must be conservative and validated, not client-controlled. |

Supabase hosted functions inject URL and key material; current docs recommend its newer publishable/secret key variables and document the legacy names as well. Secret keys bypass RLS and belong only in server environments. [Supabase environment variables/secrets](https://supabase.com/docs/guides/functions/secrets). A future local `.env.example` may contain names and blank/example placeholders only; actual `supabase/functions/.env` and any worker secrets must be ignored by Git. No environment variable or secret was created in this planning phase.

## 8. Files expected to change after approval

These are planning candidates, not changed files in this phase:

- `supabase/config.toml` — Supabase local/function configuration, auth verification defaults, and function-specific settings.
- `supabase/functions/evaluate/index.ts` — authenticated candidate evaluation orchestration and Gemini transport.
- Optionally `supabase/functions/generate-scenario/index.ts` and `supabase/functions/adaptive-followup/index.ts` — separate, bounded features after evaluation works.
- `src/lib/technicalEvaluatorProvider.ts` — align types/schema with versioned request/response, verifier evidence references, and server-side score reconciliation; do not add secret-bearing browser code.
- `src/lib/sqlClient.ts` and assessment submission call site — switch from Vite-only `/api/evaluate/sql` to the deployed authenticated endpoint, retaining the UI and existing typed response shape.
- `src/server/sqlEvaluatorPlugin.ts` and `src/server/sqlite_sandbox.py` — keep dev-only, replace, or remove from production path only after a hosted worker is available and migration verified.
- `src/lib/sqlEvaluation.ts` / `src/lib/evaluation.ts` — extract reusable deterministic policy and hybrid score composition if needed, without changing visual components.
- Challenge/rubric data definitions — ensure hidden rubrics are server-side only; client currently imports challenge data and must not be trusted to keep rubric secret if it is bundled.
- `tests/benchmarks/*`, `tests/*`, and a new Gemini contract/provider test suite — mocked transport, output schema, verifier contradiction tests, cost/token/timeout fallback tests, plus a private/unseen benchmark evaluation harness.
- `.env.example`, `.gitignore`, deployment documentation — variable names and local secret exclusion. No actual credentials.
- Potential `src/types.ts` / assessment persistence/report mapping — only if an approved final evaluation metadata contract requires it; preserve existing reports and assessment history.

Before implementation, decide whether the first release uses Supabase Edge Functions alone for orchestration and a separately hosted SQL worker, or uses a single managed backend that can securely host both. No frontend Supabase client/package is currently present in the repository. Adding one is not inherently required just to call a Function if the app uses authenticated fetch/JWT, but auth integration will need a deliberate decision.

## 9. Implementation stages

1. **Contract and data policy:** Agree on final criteria, score ownership/blending, reference-review process, candidate consent/retention, auth model, and whether Gemini is advisory or impacts displayed scores.
2. **Secure runtime foundation:** Initialize Supabase Functions config only after approval; configure server secrets without putting credentials in source; secure JWT verification, CORS, size limits, rate limits, and observability. Do not create database tables until separately approved.
3. **Provider contract tests:** Tighten TypeScript input/output schema, runtime JSON Schema validation, deterministic weighted recomputation, contradiction rejection/override, timeout and malformed response behavior. Use a fake transport; do not require a real API key for unit tests.
4. **Verifier service boundary:** Move SQL verification from Vite-local middleware to a containerized or managed isolated worker with resource enforcement, private service auth, ephemeral database, bounded fixtures/results, and explicit no-egress policy. The Edge Function orchestrates but does not execute candidate code itself.
5. **Gemini shadow evaluation:** Implement server-side Gemini transport and pinned model ID. Run existing 20 and 8 cases with identical verifier evidence; preserve output as diagnostic, while deterministic scores remain canonical.
6. **Independent benchmark review:** Have a technical evaluator review ambiguous reference scores/bands; create fresh unseen cases after policy freeze. Compare model and deterministic results with calibrated metrics and case-by-case audits.
7. **Staged product integration:** Only after benchmark gates pass, connect the existing submission route to Edge Functions while preserving the approved UI and reports. Add visible product disclosure that evaluation is automated and limitations are present, subject to product approval.
8. **Follow-up features:** Add adaptive questions and scenario generation as separate products only after their own security, leakage, quality, and cost benchmarks.

## 10. Risks and unresolved decisions

- **Evaluator validity:** Gemini may produce persuasive but wrong technical analysis, be inconsistent across equivalent solutions, or over-credit plausible prose. Benchmark size and provisional references are too small for a real-candidate accuracy claim.
- **Reference quality:** Phase 2 reports the 20 original point labels are provisional and contain disputed values. Independent labels or accepted ranges are needed before score-agreement rates can be meaningful.
- **Verifier security:** Current Python process and SQLite restrictions are not OS-level sandboxing. Public candidate SQL must not be enabled until hard resource isolation and worker security are validated.
- **Score ownership:** Decide whether deterministic verification owns 65% and Gemini scores only reasoning/understanding (35%), or whether a bounded hybrid score is desired. Prevent double-counting, and document exact ceilings and reconciliation.
- **Hidden rubric exposure:** Current challenge definitions are client-imported. Any rubric currently bundled to the browser cannot be considered hidden. Split candidate-visible challenge text from server-only rubric before claiming rubric confidentiality.
- **Authentication:** No Supabase client/config is present. Decide whether candidate assessments are authenticated, guest-based, or recruiter-issued, and how Edge Functions map submissions to owned assessment records.
- **Persistence:** No schema is present. Do not add tables/migrations in this phase. Later, define ownership/RLS and migration behavior without overwriting LocalStorage history.
- **Data handling:** Candidate responses may contain personal information. Decide consent, retention, deletion, logging, geographic processing, and acceptable use of Gemini API data before sending real submissions.
- **Cost/quota drift:** Free tier quotas are project/model-specific, may change, and may be unsuitable for production. The 3.8 Flash introductory price ends 2026-12-31. Apply hard daily/monthly budgets and alerting.
- **Latency and availability:** One call is expected per submission, but cold starts, provider throttles, malformed outputs, and worker delays add failure paths. Establish timeouts and deterministic fallback semantics.
- **Scenario leakage:** Generative scenario creation can reveal rubric/answer patterns or create untestable tasks. Generated challenges require deterministic validation and human approval.
- **Employment use:** The system supports hiring decisions. The model should not be the sole basis of decisions; recruiters need evidence, uncertainty, and a human review process. Product/legal review may be required before use with real candidates.

## Recommendation

Proceed with a **Gemini shadow evaluator behind a Supabase Edge Function**, backed by a separately isolated SQL worker. Keep the deterministic score as the canonical candidate result until the model demonstrates improved performance on independently reviewed labels and fresh unseen cases. Do not expose a live Gemini integration or claim production readiness at this point.
