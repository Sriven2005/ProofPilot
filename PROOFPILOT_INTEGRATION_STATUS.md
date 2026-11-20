# ProofPilot Integration Status Audit

**Audit date:** 2026-11-17
**Scope:** Read-only source/configuration inspection. No package installation, code changes, environment changes, test execution, or live Gemini API request was performed. This report is the only file created.

Status definitions: **WORKING** means directly verified by a safe check; **CONFIGURED** means wired or populated but not end-to-end live-verified; **MISSING** means not present; **UNVERIFIED** means evidence is insufficient or a required live check was explicitly not performed.

| SERVICE | COMPONENT | STATUS (WORKING / CONFIGURED / MISSING / UNVERIFIED) | EVIDENCE | NEXT ACTION |
|---|---|---|---|---|
| Supabase | `@supabase/supabase-js` package | MISSING | Not in `package.json` or `package-lock.json`; `npm ls @supabase/supabase-js --depth=0` reported an empty dependency result. | Add it only as part of an approved application integration. |
| Supabase | Client imported by the app | MISSING | No Supabase references or client construction in `src/`, `vite.config.ts`, or `package.json`. | Implement a client after deciding auth/session handling. |
| Supabase | Project URL and publishable/anon key in `.env.local` | MISSING | Checked variable names and whether values were empty without printing values. `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_PUBLISHABLE_KEY`, and the corresponding `VITE_` names are absent. | Add the project URL and publishable key under the names chosen by the future client code. Do not use a service-role key in the browser. |
| Supabase | Environment names match application code | MISSING | No Supabase environment-variable references exist in application/configuration code. | Establish one documented variable naming convention when implementing the client. |
| Supabase | Authentication and email OTP | MISSING | No Supabase Auth client, OTP calls, verification calls, or auth-state subscription were found. | Implement and test sign-in, OTP verification, sign-out, and session restoration if required. |
| Supabase | Database queries and RLS integration | MISSING | No Supabase query client or `.from(...)` calls; no schema/migration files were found. | Define data ownership and policies first; add tables and RLS only after approval. |
| Supabase | Migrations/schema files | MISSING | No `.sql` files, `supabase/` directory, or migration directory/files were found in the project workspace (excluding dependencies/build output). | Create migration artifacts only during an approved database phase. |
| Gemini | Local API key | CONFIGURED | `.env.local` contains a non-empty `GEMINI_API_KEY`. Its value was not printed, copied into the report, or sent in a request. | Keep it private and continue to ignore `.env.local`; rotate it if it was exposed elsewhere. |
| Gemini | Model configuration | CONFIGURED | `.env.local` sets `GEMINI_MODEL=gemini-3.8-flash`; this name is read server-side in `vite.config.ts`. | Confirm the model remains enabled for this Google project before a live call. |
| Gemini | API endpoint and credential handling | CONFIGURED | `src/server/geminiTransport.ts` calls the Gemini Developer API `v1beta` `generateContent` endpoint using the model from `GEMINI_MODEL`; the key is sent in `x-goog-api-key`. `vite.config.ts` loads server environment values and passes only key/model into server middleware; no `VITE_` secret name is used. | Keep the transport server-side and do not add the key to client `define` settings or frontend configuration. |
| Gemini | SQL assessment workflow connection | CONFIGURED | `src/App.tsx` routes `analyst-sql-retention` submissions to `evaluateSqlAnswer`; `src/server/sqlEvaluatorPlugin.ts` runs SQLite verification, sends its deterministic result, then starts `runSqlShadow` only in `configureServer`. Preview middleware disables Gemini shadow calls. | Perform a local live smoke test with a synthetic submission after approval. |
| Gemini | Structured result validation and error handling | CONFIGURED | Provider code validates criterion results, exact evidence excerpts, verifier check IDs/statuses, score bounds, and a deterministic score ceiling. Timeout/quota/network/malformed/configuration errors are caught in the shadow task; the official response is sent first. Existing mocked test source covers these paths, but this audit did not run tests. | Run the mocked Gemini suite and then test live behavior with a non-sensitive answer when approved. |
| Gemini | Influence on official score or reports | WORKING | Source inspection shows `evaluateSqlBenchmark` creates the official `Evaluation`, the middleware sends it before starting Gemini, and the shadow output is not returned to the browser or passed into assessment persistence/report generation. | Retain this separation and re-check it if the submission or report path changes. |
| Gemini | Live API/key/quota verification | UNVERIFIED | No Gemini API request was made, as instructed. A non-empty local variable does not prove the key is valid, the project has quota, or the model is accessible. | Approve a local live test using a synthetic submission; inspect terminal logs for a successful `proofpilot.gemini_shadow` event. |
| Security | `.env.local` ignored by Git | WORKING | `git check-ignore -v .env.local` matched `.gitignore` rule `.env.*`; `.env.local` is not tracked. | Keep secret-bearing environment files ignored. |
| Security | API key accidentally exposed in current frontend source/build | WORKING (pattern scan) | A filename-only scan found no recognized API-key/private-key patterns in frontend source or the current `dist` bundle. The source uses server-only `GEMINI_API_KEY`, and the bundle scan found no `GEMINI_API_KEY`, `GEMINI_MODEL`, or Gemini endpoint string. | Repeat the scan after any Vite environment or bundling changes. |
| Security | Committed-secret history | UNVERIFIED | The current Git repository has zero commits and zero tracked files; therefore there is no committed history to audit. Workspace files are untracked, so this check cannot establish whether a secret was committed in another repository/history. | Check the actual remote repository and its history with a secret scanner before pushing or sharing it. |
| Security | Candidate data in local diagnostic logs | CONFIGURED / REVIEW | `sqlGeminiShadow.ts` logs criterion evidence/explanations with request IDs; email and phone-like strings are redacted, but other identifying text could remain. The full submission and SQL result rows are not logged. | Use synthetic data for live tests; consider disabling or further minimizing evidence logging before real candidate use. |

## Supabase overall status

**MISSING — ProofPilot is not connected to Supabase in this repository.** The local project URL previously shared in conversation is not represented in `.env.local` or application code. There is no Supabase package/client, authentication, OTP, query, RLS, or migration integration.

**Exact next action:** approve a Supabase implementation phase; then use the existing project URL and its publishable key to define the client environment names and implement/test the client and auth flow. Database tables and RLS policies should remain a separately approved step.

## Gemini overall status

**CONFIGURED, LIVE STATUS UNVERIFIED — the local shadow evaluator is wired to SQL assessment submissions and its local key/model variables are populated, but no real Gemini request was made.** Gemini is not the official score source.

**Exact next action:** approve one local smoke test using a synthetic SQL submission. It will send the candidate answer, challenge/rubric content, and bounded verifier evidence to Google's Gemini API. No key needs to be shared in chat.

## Security concerns

- `.env.local` is ignored and not tracked, and no recognized credential patterns were found in the current frontend source or bundle.
- This checkout has no Git commits, so past committed-secret exposure cannot be ruled out; inspect the actual remote/history before publishing.
- The local Gemini variable is non-empty, but its validity and quota have not been checked. Do not copy or display it.
- Diagnostic terminal logs can contain short candidate evidence snippets. Email and phone-like patterns are redacted, but other personal data could appear; use synthetic submissions for testing.
- A live evaluation call will transmit the submitted answer and rubric context to Google. Confirm that the test data is appropriate before making the call.

No live API calls or tests were run for this read-only audit. No source, dependency, database, or environment files were modified.
