# ProofPilot Gemini Shadow Evaluator — Phase 3A

**Status:** Local-development shadow integration implemented. Gemini remains diagnostic only; no real Gemini request was made during automated tests because no API credential was configured or read.

## Summary

The existing SQL submission middleware now sends a separate, asynchronous Gemini evaluation after computing and returning the current deterministic result. Gemini output is schema-checked, evidence snippets must exactly match the submitted answer or verifier evidence, and every verifier check must be echoed with its exact pass/fail status. A verifier contradiction invalidates the diagnostic. Model errors are logged as unavailable and do not fail or alter the candidate assessment.

The Gemini call is registered only in Vite's development middleware. Vite preview continues to use the existing deterministic SQL route without the Gemini shadow call. No UI, CSS, assessment persistence, report output, database, Supabase, or deployment configuration was changed.

## Files changed

- `.gitignore` — ignore `.env` and `.env.*`, while allowing the placeholder `.env.example`.
- `.env.example` — placeholder names for `GEMINI_API_KEY` and `GEMINI_MODEL`; contains no credential.
- `vite.config.ts` — reads server environment variables with Vite `loadEnv` and passes only the two selected variables to the server-side provider transport.
- `src/lib/technicalEvaluatorProvider.ts` — stricter response validation, verified-execution claim reconciliation, exact evidence-source validation, server-side weighted recomputation, and deterministic score-ceiling enforcement.
- `src/server/geminiTransport.ts` — Gemini Developer API REST transport, structured JSON response schema, bounded output, timeout, one bounded transient retry, and sanitized failure categories.
- `src/server/sqlGeminiShadow.ts` — challenge/rubric/evidence request construction and request-ID structured diagnostics; no submission is written to persistence.
- `src/server/sqlEvaluatorPlugin.ts` — runs the Gemini shadow only after returning the existing deterministic result, and only under Vite development middleware.
- `tests/gemini_shadow.test.ts` — mocked transport and dev middleware tests.
- `package.json` — adds `npm run test:gemini-shadow`.
- `PROOFPILOT_GEMINI_SHADOW_PHASE3A.md` — this report.

No UI, CSS, styling, visual component, navigation, LocalStorage, report-generation, or SQL scoring file was changed.

## Architecture and request flow

1. The candidate posts the SQL challenge answer to the existing `/api/evaluate/sql` Vite route.
2. The existing parser and isolated SQLite subprocess run as before. `evaluateSqlBenchmark` computes the official result without using Gemini.
3. The middleware sends that original deterministic `Evaluation` response to the browser.
4. Only in Vite development mode, a background task builds a separate request from the authoritative challenge description, server-loaded rubric, candidate answer, and bounded SQLite/schema/probe evidence.
5. The server calls Gemini's `generateContent` REST endpoint. It uses the `x-goog-api-key` header and a JSON response schema. Google documents this endpoint, authentication header, structured output configuration, and model support in the [Generate Content API](https://ai.google.dev/api/generate-content), [API reference](https://ai.google.dev/api), and [structured output guide](https://ai.google.dev/gemini-api/docs/structured-output).
6. The provider validates five criterion results, exact names, numeric bounds, required text/arrays, evidence excerpts, and execution claims. It ignores the model's suggested total and recomputes the diagnostic weighted score server-side.
7. When the deterministic essential gate has fired, the official deterministic score is passed as the diagnostic maximum. The model cannot raise the shadow result beyond that ceiling.
8. A successful diagnostic is logged with a request ID, criterion scores and feedback, confidence, and uncertainty. Candidate answer bodies and SQL result rows are not logged. Email addresses and phone-like strings in feedback are redacted. If credentials, provider, schema, or network handling fails, a short structured `unavailable` event is logged. No model response is returned to the browser, stored in LocalStorage, or inserted into reports.

The candidate submission is treated as untrusted data in the prompt; it cannot replace evaluator policy. Gemini does not execute SQL. Execution-check IDs and outcomes come only from the SQLite result, and the provider rejects a missing or contradictory execution claim.

## Model and API configuration

- REST API: `POST https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent`.
- Selected placeholder model: `gemini-3.8-flash`. Google's current official model guide lists this stable model; availability and model IDs can change, so check the [current model catalog](https://ai.google.dev/gemini-api/docs/models) before use.
- Structured output: `generationConfig.responseMimeType = "application/json"` and `generationConfig.responseSchema`; output is capped at 1,800 tokens. Gemini structured output supports a JSON Schema subset, so ProofPilot also validates the parsed response at runtime. [Structured output documentation](https://ai.google.dev/gemini-api/docs/structured-output).
- Request timeout is 12 seconds per attempt, with at most one retry for transient network/upstream/quota errors. A quota failure, timeout, malformed JSON, invalid schema, or missing credential leaves the official score untouched.
- API key is supplied only through the server's `x-goog-api-key` request header. Google warns against exposing Gemini API keys in browser code and recommends server-side calls. [Gemini API key security](https://ai.google.dev/gemini-api/docs/api-key).

### Local environment

1. Copy `.env.example` to `.env.local` in the project root.
2. Set `GEMINI_API_KEY` to a key created in Google AI Studio and leave `GEMINI_MODEL=gemini-3.8-flash`, or set another model ID currently enabled for that project.
3. Keep `.env.local` untracked. `.gitignore` ignores `.env`, `.env.*`, and all `*.local` files; `.env.example` is the only environment-file exception and has an empty key value.
4. Run `npm run dev` bound to localhost. Submit the SQL retention assessment and inspect the Vite terminal for `proofpilot.gemini_shadow` JSON events keyed by `requestId`.

Do not paste an API key into the app UI, source code, browser devtools, LocalStorage, or a chat. No existing environment file contents or secret values were read or printed during this work.

## Official score and weight preservation

- The original deterministic SQL evaluator remains the sole source of the candidate-facing score and is computed before the shadow call.
- `src/lib/sqlEvaluation.ts` was not changed, and no score-combination logic was added to the official assessment path.
- The current repository's actual weights are **Problem understanding 15%, Technical correctness 25%, Reasoning and approach 20%, Practical implementation 25%, Measurement and validation 15%**. `technicalEvaluatorProvider.ts` already used these same values; this task preserved them for the Gemini diagnostic.
- The task brief lists analytical reasoning at 25% and practical solution at 20%, which swaps the existing repository's 20/25 values. To honor the instruction not to modify official scoring or its existing weights, this implementation follows the actual existing SQL evaluator/provider weights. Resolve that discrepancy explicitly before any future score-policy change.
- Shadow response data is never passed into `evaluateSqlBenchmark`, assessment state, LocalStorage, reports, or recruiter-facing output. The middleware responds before invoking Gemini.
- On essential verifier failure the diagnostic is capped at the official deterministic result's score (no higher than the existing essential cap); this does not change the official result.

## Tests and results

All requested automated suites were run locally without a real Gemini key:

| Command | Result |
|---|---|
| `npm run build` | PASS — TypeScript build and Vite production bundle completed. |
| `npm run test:evaluator` | PASS — 8 baseline plus 40 cross-role evaluator cases. |
| `npm run test:benchmark` | PASS — all 20 SQL benchmark cases; deterministic baseline MAE remains 11.10 and 9/20 (45%) within ±5, unchanged by shadow integration. |
| `npm run test:regression` | PASS — 10 cases, 3 valid, 7 invalid, 0 valid misses, 0 false-high scores. |
| `npm run test:sql-blind-holdout` | PASS — 8 cases, 3 valid, 5 invalid, 0 valid misses, 0 false-high scores. |
| `npm run test:sql-workflow` | PASS — 4 live local Vite route cases: valid score 83, essential failure 49, irrelevant 0, wrong challenge 400. Gemini was unconfigured; each official result completed normally while shadow logs reported configuration unavailable. |
| `npm run test:gemini-shadow` | PASS — 11 mocked cases covering valid JSON, invalid schema, malformed JSON, missing key, timeout, quota retry, verifier contradiction, essential cap, valid alternative, provider failure, and actual dev middleware score isolation. |
| `npm run lint` | PASS — exit code 0. Four pre-existing warnings remain: one unused test generator parameter and three React `set-state-in-effect` warnings in `src/App.tsx`. |

The actual dev middleware test gave the mock model criterion scores of 80 for an irrelevant `SELECT 1` response. The returned official assessment stayed at 0. A second mock provider failure also left the route at HTTP 200 and score 0. This verifies isolation in the local request flow; it does not evaluate Gemini's real technical accuracy.

The production build output contains no `GEMINI_API_KEY`, `GEMINI_MODEL`, or Gemini Developer API URL. The Gemini transport is imported by `vite.config.ts` and server middleware only, not by client application code.

## Known limitations

- No live request was made; real model quality, quota behavior, latency, and model/project access are unverified until manual testing with a developer-provided key.
- This is a local Vite development experiment, not a production backend. Do not expose the Vite server to public or untrusted traffic.
- The existing Python/SQLite containment is still not an OS-level sandbox; this phase does not upgrade SQL execution isolation.
- The existing benchmark remains weak against provisional references: original SQL results were 45% within ±5. Gemini is not claimed to improve that rate.
- Exact substring validation reduces fabricated evidence but cannot prove the model's semantic claims or prevent every misleading explanation. Shadow output is diagnostic only.
- The local terminal diagnostic includes criterion evidence and explanations needed for inspection, with email and phone-like strings redacted. It does not log the full submission or result dataset.
- Free quota and pricing are model-, project-, and account-dependent. Check current [Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) and pricing before extended experiments.
- The official code weight mismatch described above remains unresolved by design; no existing weights were changed.

## Manual real-key smoke test

1. Create a Gemini API key using Google AI Studio. Keep it private.
2. Copy `.env.example` to `.env.local`; set `GEMINI_API_KEY` locally and retain the supported model ID `gemini-3.8-flash`.
3. Start the local server with `npm run dev` and use the local browser URL printed by Vite.
4. Submit the SQL retention challenge once with a good solution and once with a deliberately incorrect/irrelevant submission.
5. In the Vite terminal, match `proofpilot.gemini_shadow` logs by request ID. Compare `officialScore` with `diagnosticScore` and review each criterion's evidence, mistakes, alternatives, confidence, and uncertainty.
6. Confirm the browser response/report score remains deterministic in both submissions. Then unset the key or stop the server; never commit `.env.local`.

No production deployment, Supabase setup, database changes, or real-candidate evaluation is part of this phase.
