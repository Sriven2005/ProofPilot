# ProofPilot Phase 2.1 — Database Security Hardening

**Migration applied:** No.
**Hosted database/settings changed:** No.
**`.env.local` read or changed:** No.
**Readiness:** **NOT READY for hosted application until staging PostgreSQL/RLS tests pass.**

## Changes made

### Migration safety

Updated `supabase/migrations/202611180001_phase2_progress_foundation.sql`:

- Added a preflight before DDL. It stops if any target table/relation, function, trigger name, or index name already exists.
- Replaced `CREATE TABLE IF NOT EXISTS` and `CREATE OR REPLACE FUNCTION` with plain creates that fail on name collisions.
- Removed trigger drop/recreation. Trigger creation is now plain `CREATE TRIGGER` after the preflight.
- The bootstrap is deliberately one-time. Rerunning after success fails at preflight without changing existing objects. The normal migration workflow must skip it once its timestamp is recorded.

Added `supabase/migrations/202611180002_phase2_1_security_hardening.sql`:

- Checks that the expected Phase 2 tables, columns, functions, and policy names/commands exist. It aborts on an incompatible schema or unexpected extra policy rather than silently adopting it.
- Enables RLS, makes read policies owner-scoped, and restricts write policies to the trusted database-function context.
- Revokes anonymous/public access and all direct authenticated table privileges on finalized attempts, criterion results, practice events, proof results, and report references. It also revokes column-level insert/update grants. Authenticated users retain select access to their own rows through RLS.
- Revokes authenticated execution of the older invoker RPC.
- Adds `assessment_attempts.score_trust`, defaulting existing/new rows to `client_unverified`, and adds child-key indexes. Incompatible pre-existing definitions fail with an error.
- Adds the new `save_assessment_attempt_v2(jsonb,text)` function under a versioned name, without replacing any existing routine. It is `SECURITY DEFINER`, uses an empty `search_path`, requires a migration owner with `BYPASSRLS`, derives ownership from `auth.uid()`, and grants execution only to `authenticated`.
- The function is insert-only for clients and validates five criteria, 100 total weight, weighted-score arithmetic, and agreement between the score/criteria snapshots. It returns an existing row for a repeated owner/report reference or legacy source ID.
- The client function accepts only `assessment` or `practice`; it rejects `proof`. There is no client operation that creates or marks a proof result verified.

The second migration is **rerun-guarded**, not silently rerunnable: if its versioned function already exists, it aborts before making changes. Migration history should prevent normal re-execution. If a partial run failed before function creation, its guarded column/index/policy operations are designed to be retried; inspect the database first if any apply attempt reports an error.

### Application and score disclosure

- `src/lib/assessmentRepository.ts` now writes through `save_assessment_attempt_v2` and reads `score_trust` from account history.
- `src/lib/database.types.ts` reflects the trust field and disallows typed client updates to protected rows; proof inserts are typed as unverified only.
- `src/types.ts` adds optional score-trust metadata. New assessment records are marked `client_unverified`.
- `src/App.tsx` displays an explicit unverified-score disclosure in the existing report copy. No CSS, layout, navigation, or visual styling was changed.
- No evaluator, Gemini, official scoring weights, or LocalStorage records were changed. The deterministic score is still produced by the existing assessment flow.

## Score-integrity boundary

The database now blocks authenticated users from directly changing or deleting finalized score/result rows. The new RPC also prevents arithmetic inconsistencies and repeated writes for the same report reference.

**The score is still untrusted.** An authenticated candidate can call the RPC with a fabricated but internally consistent score, criterion breakdown, evidence, and answer, or create a new assessment under a new report reference. The function validates data shape and arithmetic; it does not evaluate the candidate's answer. Such rows are always stored as `client_unverified`, and the report says they have not been independently verified. There is no trusted evaluator or server-side proof-verification operation in this phase.

Proof results are separately protected: direct authenticated writes are revoked, no authenticated update policy exists, and the new client RPC refuses proof mode. A future privileged server operation could still write/alter verified results, so its credentials and authorization must remain server-side and be tested separately.

## Security tests and verification actually executed

| Check | Result | Scope |
|---|---|---|
| `npm run build` | **PASS** | TypeScript and Vite production build. |
| `npm run test:database` | **PASS** | Static SQL/application contract assertions for anonymous grants, owner checks, ownership derivation, direct write revocation, score trust, proof restrictions, duplicate guards, and migration collision/rerun behavior. **Not a PostgreSQL test.** |
| `npm run test:progress` | **PASS** | Existing 8 progress assertions. |
| `npm run test:persistence` | **PASS** | Existing 6 LocalStorage preservation assertions. |
| `npm run test:evaluator` | **PASS** | Existing 48 evaluator cases; evaluator code/score rules unchanged. |
| `npm run test:benchmark` | **PASS** | Existing 20 SQL benchmark cases executed. Calibration remains as previously reported: 45% within ±5 reference points. |
| `npm run test:regression` | **PASS** | Existing 10 holdout cases. |
| `npm run test:sql-blind-holdout` | **PASS** | Existing 8 blind holdout cases. |
| `npm run test:sql-workflow` | **PASS** | Existing 4 workflow cases. |
| `npm run test:gemini-shadow` | **PASS** | 11 mocked shadow-evaluator cases; Gemini behavior was not changed. |
| `npm run test:auth` | **PASS** | 7 email OTP helper cases. |
| `npm run lint` | **PASS with warnings** | Exit code 0; four warnings remain (three existing `App.tsx` effect warnings and one unused parameter in `tests/generate_phase2_report.ts`). |

The security assertions inspect migration contents. They do **not** prove that PostgreSQL accepts the SQL, that RLS denies real JWT requests, or that the definer function behaves as intended under Supabase roles. No PostgreSQL/Supabase CLI executable was available, and no live project request was made.

## Migration readiness and sequencing

**NOT READY for hosted application.** Live PostgreSQL execution and RLS tests remain required.

Important version-history caveat: the original Phase 2 migration file was hardened in-place, but the remote migration ledger is unknown. If timestamp `202611180001` is already recorded remotely, Supabase will not replay the edited bootstrap file; do not run it manually. If it is unrecorded while any target objects exist, its new preflight will stop. Inspect remote history/schema first and use an explicit adoption/repair migration if needed. Do not use migration repair to conceal a mismatch.

After approval, the safe sequence is:

1. Back up the project and review the remote schema, object names, grants, policies, and migration ledger.
2. Test both migrations on a staging project with equivalent Auth configuration. Run `supabase migration list --remote` and `supabase db push --dry-run --remote` to confirm the exact pending migration set.
3. Apply only after staging tests pass and the migration plan is approved. Then inspect effective table privileges and policies.
4. Using two disposable authenticated accounts and an anonymous client, test cross-user reads/writes, ownership changes, direct score update/delete, proof verification attempts, duplicate RPC submissions, and retry behavior. Confirm own-row reads work and only the intended RPC writes rows.
5. Deploy the frontend only after migration 002 is applied; the updated client expects the versioned RPC and `score_trust` column. Before that, sync requests fail safely to the existing LocalStorage path.

## Remaining risks

- The function has a powerful definer context. Its owner is required to bypass RLS, and the owner/search-path/policy behavior must be confirmed in staging. Do not grant its execution to anonymous users or expose privileged credentials.
- Scores, evidence text, evaluator version, and answers remain client-submitted. The trust flag and report disclosure prevent a claim of independent verification but do not make those evaluations credible proof.
- Repeated calls with the same report reference/source ID are idempotent; semantically identical submissions with newly generated report IDs are still separate attempts.
- `ON DELETE CASCADE` from `auth.users` remains. Account deletion removes the user's stored assessment history.
- Public recruiter report sharing and a trusted proof evaluator remain unimplemented.
- No UI/SQL browser execution against Supabase was performed; this phase does not assert that the hosted project is configured or working.

**Files changed:** `supabase/migrations/202611180001_phase2_progress_foundation.sql`, new `supabase/migrations/202611180002_phase2_1_security_hardening.sql`, `src/lib/assessmentRepository.ts`, `src/lib/database.types.ts`, `src/types.ts`, `src/App.tsx`, `tests/database_foundation.test.ts`, and this report.
