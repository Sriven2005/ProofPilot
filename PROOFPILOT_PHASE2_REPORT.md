# ProofPilot Phase 2 — Database, Persistence & Progress Foundation

**Status:** Application and migration foundation implemented locally. The migration has not been applied to Supabase, and live database behavior has not been verified.

## 1. Summary

ProofPilot now has a typed browser persistence client/service path for the signed-in user, a PostgreSQL migration with owner-scoped RLS, account-backed assessment history, profile ensure/load behavior, and a deterministic progress calculation helper. Existing LocalStorage records remain in place. Import is an explicit action; opaque records are disclosed and retained, and corrupted storage is not overwritten.

No database tables, policies, or functions were created on the hosted project during this work. No secrets or `.env.local` values were read or changed. The existing CSS files, evaluator, challenge definitions, Gemini shadow path, and report layout were not changed. `App.tsx` has small functional additions for database status and the explicit import action using existing UI classes.

## 2. Database schema and migration

Migration: `supabase/migrations/202611180001_phase2_progress_foundation.sql`.

| Table | Purpose |
|---|---|
| `user_profiles` | One profile per `auth.users` UUID, created/retrieved after sign-in. |
| `assessment_attempts` | Attempt/submission, role and challenge IDs, assessment mode, answer, challenge/evaluation snapshots, score, timestamps, evaluator version, report reference, and optional legacy source ID. |
| `assessment_skill_results` | Criterion-level score, weight, evidence, missing items, incorrect items, and explanation, linked to its owning attempt. |
| `practice_history` | Optional hint, explanation, resource, and practice-submission events. The database permits these only for practice-mode attempts. |
| `proof_results` | One-to-one proof verification record, distinct from practice. Authenticated browser users may create only unverified rows; there is no client update policy that would allow self-verification. |
| `evidence_reports` | Private report reference linked to an attempt. Public report sharing is not enabled. |

IDs use UUIDs for database entities. The SQL save function creates an attempt, five criterion rows, and its private report reference in one transaction. It derives `user_id` from `auth.uid()` rather than accepting an owner ID from the client. The function is `SECURITY INVOKER`, and it is executable only by authenticated users. Foreign keys, uniqueness constraints, score/weight bounds, mode/status checks, text/payload limits, and indexes are included.

Role, role-skill, rubric, and challenge definitions remain in the existing application catalog (`src/data/challenges.ts` and `src/data/rubrics.ts`). This avoids duplicating static catalog data in PostgreSQL. Challenge and evaluation snapshots are saved with each attempt to retain the version used at submission time.

Current browser submissions are stored as mode `assessment`. The application does not yet offer distinct Practice and Proof workflows, so existing results are not relabelled as verified proof. Practice and proof-specific tables are ready for those later flows.

## 3. Row Level Security and ownership

RLS is enabled on every table in this migration. There are no intentionally public tables. The policies scope reads, inserts, updates, and deletes to `auth.uid()`. Child rows use composite foreign keys `(attempt_id, user_id)` and policies that check ownership of the parent attempt. Practice events additionally require a practice attempt; proof rows additionally require a proof attempt. A client cannot create a verified proof result or update an unverified result into a verified one.

The app uses the existing publishable-key client. No service-role key is included. RLS enforces row ownership, but it does not make browser-submitted evaluations tamper-proof; see limitations below.

## 4. Application integration

Files added:

- `src/lib/database.types.ts` — explicit TypeScript database schema types.
- `src/lib/assessmentRepository.ts` — profile ensure/retrieval, attempt save, account history retrieval, and consent-gated legacy import.
- `src/lib/progress.ts` — latest/previous score calculation, separated by assessment mode; a first attempt has no change value.
- `supabase/migrations/202611180001_phase2_progress_foundation.sql` — PostgreSQL schema, RLS, and transactional save function.
- `tests/assessment_progress.test.ts`, `tests/database_foundation.test.ts`, `tests/persistence_compat.test.ts` — new focused tests.

Files modified:

- `src/lib/supabase.ts` — typed the existing client with the new database schema.
- `src/lib/persistence.ts` — added safe inspection/appending helpers that preserve unknown LocalStorage entries and refuse to overwrite malformed storage.
- `src/types.ts` — added an optional account-backed assessment mode.
- `src/App.tsx` — loads/ensures the signed-in profile, retrieves account history, saves new deterministic results to the account while preserving the existing browser copy, shows sync state, and adds a confirmation step for legacy import.
- `package.json` — added `test:progress`, `test:database`, and `test:persistence` scripts.

If profile/history retrieval or the database save fails, the existing assessment flow completes and the browser copy remains available. A failed save can be retried through the explicit import path. Account history is merged in memory with browser records without writing the fetched account records back over LocalStorage. Imported local rows are skipped when the report reference is already in the account; the SQL function also uses per-user legacy/report references to make retries duplicate-safe.

## 5. LocalStorage compatibility and migration

- Existing `proofpilot.assessments.v1` values are not cleared during this phase.
- New submissions are appended while retaining unrecognized legacy objects.
- Invalid JSON or a non-array storage shape is not overwritten by a new submission.
- The user must click **Import saved browser assessments** and approve a browser confirmation before records are sent to Supabase.
- The confirmation discloses unsupported/corrupted record counts. Those records are not sent and remain in browser storage.
- A failed multi-record import may have committed earlier rows; retries are safe and skip already-present reports.
- LocalStorage remains browser-profile data and is not intrinsically associated with a particular email account. The user’s explicit confirmation is the association decision for import.

## 6. Progress foundation

`calculateAssessmentProgress` returns each challenge’s latest and previous result for a specified mode, and reports `change: null` when there is only one attempt. Practice records are excluded from assessment-mode results. No dashboard progress values were added, and no improvement is inferred from insufficient history.

## 7. Tests and build results

| Check | Result | Evidence |
|---|---|---|
| `npm run build` | **PASS** | TypeScript project build and Vite production build completed. |
| `npm run test:evaluator` | **PASS** | 8 baseline plus 40 cross-role cases. Existing scores/calibration unchanged. |
| `npm run test:benchmark` | **PASS** | 20 SQL cases executed; 9/20 (45%) within ±5, 12/20 (60%) within ±10, mean absolute difference 11.1, zero false-positive high scores. This remains weak calibration. |
| `npm run test:regression` | **PASS** | 10 holdout cases; 0 valid misses and 0 false-high cases. |
| `npm run test:sql-blind-holdout` | **PASS** | 8 cases; 0 valid misses and 0 false-high cases. |
| `npm run test:sql-workflow` | **PASS** | 4 workflow cases; valid response 83, invalid response 49, irrelevant response 0, wrong challenge returns 400. |
| `npm run test:gemini-shadow` | **PASS** | 11 mocked shadow-evaluator cases. |
| `npm run test:auth` | **PASS** | 7 email OTP helper cases. |
| `npm run test:progress` | **PASS** | 8 assertions for latest/previous performance, no fabricated progress, and mode separation. |
| `npm run test:persistence` | **PASS** | 6 assertions for unknown-row preservation, malformed-data preservation, and deterministic appending. |
| `npm run test:database` | **PASS, structural only** | 18 source assertions for table declarations, RLS, auth ownership, save function access, unverified-only proof insertion, and idempotency. This does **not** execute PostgreSQL. |
| `npm run lint` | **PASS with warnings** | Exit code 0. Four warnings remain: three existing React state-in-effect warnings in `App.tsx` and one unused parameter in `tests/generate_phase2_report.ts`. |

The evaluator continues to use the repository’s existing weights: **15 / 25 / 20 / 25 / 15** (problem understanding, technical correctness, reasoning, practical implementation, measurement). This totals 100%. An earlier proposed set was **15 / 25 / 25 / 20 / 15**. The discrepancy is preserved and flagged for approval; scoring was not changed in this phase.

## 8. Live Supabase checks

No live authentication, profile, query, RLS, save, history, or import call was performed. The migration was not applied. `supabase` CLI and `psql` were not available in the environment, so no local PostgreSQL migration execution was possible. The current `.env.local` was not read or modified, and the project’s runtime credentials/configuration were not verified here.

The existing `.gitignore` matches `.env.local` (`git check-ignore` confirmed it); `.env.example` contains placeholders. The browser client continues to read only the publishable-key variables, and no service-role key was added.

To proceed, first review the migration, configure the existing local environment with `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, then apply the migration through the project’s approved Supabase migration workflow. After that, test with two authenticated users and confirm cross-user reads/writes fail under RLS before using the account sync path with real candidate data.

## 9. Security limitations and unresolved issues

1. The migration and RLS policies have not been executed against the hosted PostgreSQL project. Structural checks cannot establish SQL runtime validity or prove policies behave as expected.
2. The client calls a database RPC with the evaluation snapshot produced by the current application. An authenticated user can bypass the UI and submit or alter their own assessment data. RLS provides privacy/ownership isolation, not score integrity. Do not treat these rows as tamper-proof recruiter evidence until evaluation and write validation run in a trusted server-side boundary.
3. LocalStorage is shared by a browser profile, not partitioned by Supabase user. Legacy data remains in that profile until explicitly imported; users sharing a browser profile should review the records before choosing import.
4. The current app has no explicit practice/proof selection, time limits, unseen-task control, or proof submission cap. Current submissions therefore remain generic assessments.
5. Report references are private account records, not publicly shareable recruiter links. Public sharing needs an explicit privacy/authorization design.
6. The existing development SQL endpoint remains development-only and is not a production-isolated execution service.
7. The challenge catalog currently contains **13 challenge IDs** (4 analyst, 3 developer, 3 AI/ML, 3 designer), whereas the product description says 12. This pre-existing catalog discrepancy was not altered.
8. The existing SQL benchmark’s calibration is still weak: 45% within ±5 reference points. The migration does not change evaluator behavior or make its scores scientifically validated.

## 10. Product requirements still outstanding

- Skill taxonomy and role-to-skill coverage remain application data; generic/custom role administration is not implemented.
- SQL, Python, and Java task workspaces and other task-oriented environments are not implemented in this phase.
- Separate Practice and Proof experiences and verified proof generation are not implemented.
- Difficulty progression, proof integrity controls, and per-mode dashboards are not implemented.
- Excel/Power BI dataset and evidence-upload workflows are not implemented; Power BI Desktop remains external software.
- Public/shareable recruiter reports, access controls, revocation, and privacy review are not implemented.
- Database migration and live RLS verification remain pending.

## 11. Recommended next phase

1. Review/apply `supabase/migrations/202611180001_phase2_progress_foundation.sql` through the approved Supabase migration workflow. Extend `tests/database_foundation.test.ts` with PostgreSQL integration checks for two-user RLS isolation, RPC rollback, and duplicate import behavior.
2. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` locally without committing environment files, then validate profile creation and account history with two test users.
3. Before recruiter-grade trust, add a server-side submit/validation module (recommended new `supabase/functions/submit-assessment/index.ts`) and route writes from `src/lib/assessmentRepository.ts` through it. Keep evaluator authority server-side and never place a service-role key in the Vite client.
4. Decide and approve how legacy LocalStorage records are attributed when multiple people share a browser profile; the current import requires explicit consent and preserves source data.
5. Separately approve the rubric-weight discrepancy and resolve the 12-versus-13 challenge catalog count.

No SQL/Python/Java workspace redesign or unrelated UI work was started.
