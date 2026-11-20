# ProofPilot Phase 2 — Verification & Migration Readiness

**Audit mode:** Read-only static review. No migration, application code, environment file, database setting, or existing data was changed. No secret values were inspected or printed.

## Verdict: NOT READY

The migration has an owner-isolation baseline, but it is not ready to apply to the hosted project. Authenticated users can create, update, and delete their own score-bearing rows directly, bypassing the save RPC, and can change their own scores after submission. The RPC accepts client-provided scores and does not recompute them. Remote schema/migration compatibility and live RLS behavior are also unverified.

## 1. Migration files reviewed

The repository contains one migration: `supabase/migrations/202611180001_phase2_progress_foundation.sql`. No other migration, `supabase/config.toml`, or local PostgreSQL test setup was found. The prior `PROOFPILOT_PHASE2_REPORT.md` correctly says the migration was not applied and live RLS was not tested. The hosted migration history/schema cannot be inferred from local files.

## 2. SQL review

### Tables, keys, constraints, indexes

The migration creates `user_profiles`, `assessment_attempts`, `assessment_skill_results`, `practice_history`, `proof_results`, and `evidence_reports`.

- UUID primary keys and foreign keys are present. Child tables use `(attempt_id, user_id)` foreign keys to prevent linking child rows to another user's attempt.
- `user_profiles.user_id` and attempt `user_id` reference `auth.users(id) ON DELETE CASCADE`. Deleting an Auth user will delete that user's profile and all related assessment data; this destructive lifecycle behavior should be accepted explicitly.
- Score, weight, mode, status, text size, JSON shape, and uniqueness constraints are present. The RPC checks for exactly five criterion rows.
- No DB constraint verifies that criterion weights total 100, that `overall_score` matches weighted criterion results, or that normalized criterion rows match `evaluation_snapshot`.
- Role, challenge, and rubric IDs are text, not foreign keys. This is consistent with application-owned catalogs, but the database cannot confirm those IDs exist or agree with one another.
- Indexes cover user/history and role/history access patterns, but no index begins with `(attempt_id, user_id)` on `assessment_skill_results` or `practice_history`. Parent deletion/cascade checks may scan those tables as they grow.

### Syntax and migration behavior

Static review found no definite PostgreSQL syntax error in the DDL, foreign keys, or policy statements. The SQL was not parsed or executed by PostgreSQL, so syntax/runtime compatibility remains **unverified**.

There are no `DROP TABLE`, `TRUNCATE`, or data `DELETE` statements. There is a `DROP TRIGGER IF EXISTS user_profiles_touch_updated_at` followed by trigger recreation; that can remove an existing trigger of the same name and replace its behavior. Both helper functions use `CREATE OR REPLACE`, so an existing same-signature function can be overwritten. `CREATE TABLE IF NOT EXISTS` can silently accept a table of a different shape and let subsequent DDL fail or apply against unexpected columns.

Policies use unguarded `CREATE POLICY`; rerunning after a partial/manual application fails on duplicate policy names. The file is not safely rerunnable as written. The migration should be checked against remote schema and migration history before application.

`touch_updated_at()` does not explicitly revoke its default `PUBLIC` execute privilege. It is a trigger-returning function and is not expected to be callable as a normal PostgREST RPC, so this is low risk, but revoking `PUBLIC`/`anon` execution is better least-privilege practice. The assessment RPC does explicitly revoke from `PUBLIC` and `anon` and grant execution to `authenticated`.

## 3. RLS and ownership analysis

RLS is enabled on all six tables. Table grants are revoked from `anon` and `PUBLIC`, then `SELECT/INSERT/UPDATE/DELETE` are granted to `authenticated`. Each table has owner policies using `auth.uid()`. Child write policies check that the parent attempt belongs to the same user and, for practice/proof rows, has the expected mode.

| Table | Cross-user isolation, static review | Own-row changes allowed by current policy |
|---|---|---|
| `user_profiles` | Read/write owner checks; `WITH CHECK` prevents reassignment to another `user_id`. | Owner can edit `display_name` or delete own profile. |
| `assessment_attempts` | Owner filter and insert/update checks bind `user_id` to `auth.uid()`. | Owner can insert arbitrary own rows, update any column (including score, evaluation, answer, role/challenge, mode, timestamps), and delete. **High score-integrity risk.** |
| `assessment_skill_results` | Owner filter, parent ownership check, and composite FK. | Owner can insert/edit/delete their criterion scores, weights, evidence, and explanations. **High score-integrity risk.** |
| `practice_history` | Owner and parent checks; writes require a practice-mode attempt. | Owner can add/edit/delete own practice events. |
| `proof_results` | Owner read/delete; insert requires a proof attempt and `unverified` with null verified score/time. | There is **no authenticated UPDATE policy**, so candidates cannot update an existing result to verified. They can delete their own row. A client insert marked verified is rejected by the policy. |
| `evidence_reports` | Owner and parent-attempt ownership checks plus composite FK. | Owner can edit/delete own reference rows. The policy does not require the report reference to equal the parent attempt's reference, allowing inconsistent references within the same account. |

### Requested access/ownership checks

- **User A accessing user B:** Static predicates and composite foreign keys are written to deny cross-user reads/writes. This is not a live test. Table owners and Supabase administrative/service roles can bypass RLS by design and must remain controlled/server-side.
- **Unauthenticated access:** `anon`/`PUBLIC` table privileges are revoked and policies target `authenticated`; `auth.uid()` is null without a user session. Normal anonymous API access should be denied, but was not exercised against the project.
- **Changing ownership:** `WITH CHECK (user_id = auth.uid())` blocks changing an owned row's owner. The save RPC derives its owner from `auth.uid()` and does not accept a `user_id` field.
- **Changing own scores:** **Allowed.** Table-level `UPDATE` plus owner-only policies allow authenticated users to change their own `assessment_attempts.overall_score`, evaluation snapshot, and `assessment_skill_results.score/weight` after submission.
- **Changing a proof to verified:** Authenticated users have no `proof_results` update policy, and insert only permits unverified rows. They may delete their own proof row. A future privileged server writer would need separate controls.
- **Bypassing the RPC:** **Allowed.** Authenticated table grants and insert policies permit direct inserts into attempts, skill results, and report references. A user can bypass the RPC's exactly-five-criteria check and create partial/inconsistent own data.

Recommended correction: remove direct authenticated INSERT/UPDATE privileges on score-bearing/report tables and route writes through a trusted, narrowly validated server boundary. If using a `SECURITY DEFINER` function or service role, derive ownership from a verified JWT, use a fixed safe `search_path`, validate all fields and relationships, and grant execution narrowly. Never put a service-role key in browser code.

## 4. Application/schema compatibility

Static comparison of `src/lib/assessmentRepository.ts` against the SQL found:

- `user_profiles.upsert({user_id, display_name}, {onConflict:'user_id', ignoreDuplicates:true})` and select of `user_id,display_name` match the table and profile policies. `user_id` comes from `AuthProvider`'s Supabase Auth user.
- `rpc('save_assessment_attempt', {p_attempt, p_legacy_source_id?})` matches the SQL function signature and the payload JSON keys read by the function.
- History selects `report_reference, challenge_id, candidate_name, submitted_answer, evaluation_snapshot, assessment_mode` and orders by `completed_at`; all exist. RLS should filter rows returned by this query.
- The app does not query normalized skill results, practice history, proof results, or evidence report rows; these are currently schema foundations. History mapping uses the evaluation JSON snapshot.
- Historical report reconstruction selects no `challenge_snapshot`; it resolves challenge details from the current application catalog. A changed/removed challenge may therefore not reproduce the original wording.

The OTP AuthProvider restores a Supabase session, and the existing client uses only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. No service-role key is present in the client. This is compatible by inspection, but no live OTP or database request was made.

## 5. Migration safety and application steps

**Do not apply this migration yet.** The remote schema/history is unknown, the SQL has not been run on PostgreSQL, own scores remain mutable, and writes can bypass the RPC. The local environment had no `supabase` CLI or `psql`; no live project call was attempted.

After the migration is corrected and approved:

1. Back up the database and test against a staging project with equivalent Auth settings. Inspect remote public tables, functions, triggers, grants, policies, and migration history for name/signature conflicts.
2. Install/configure the Supabase CLI and initialize/link the project if needed. The local `supabase` directory contains migrations but no `supabase/config.toml`.
3. Link and inspect remote migration history:

   ```powershell
   supabase link --project-ref fhvghstufxqpbjfhhexcq
   supabase migration list --remote
   ```

   Confirm the timestamp is unapplied and schema assumptions match. Do not use `migration repair` to conceal a schema mismatch.
4. Dry-run and confirm only the reviewed migration is pending:

   ```powershell
   supabase db push --dry-run --remote
   ```

5. Apply only after fixes, staging tests, and separate approval:

   ```powershell
   supabase db push --remote
   ```

6. Run the catalog checks below, then API-level RLS tests using two disposable authenticated accounts and an anonymous client. Avoid real candidate records.

Supabase documents [migration history and push](https://supabase.com/docs/guides/deployment/database-migrations), [CLI migration commands](https://supabase.com/docs/reference/cli/supabase-migration-list), and [RLS/auth.uid behavior and bypass roles](https://supabase.com/docs/guides/database/postgres/row-level-security).

## 6. SQL verification queries and expected results

These queries are read-only and were **not executed**.

### RLS status

```sql
select c.relname as table_name, c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as force_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('user_profiles','assessment_attempts','assessment_skill_results',
                    'practice_history','proof_results','evidence_reports')
order by c.relname;
```

Expected: six rows and `rls_enabled = true` for each. `force_rls` is expected false; verify authenticated roles do not own these tables.

### Policy inventory

```sql
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('user_profiles','assessment_attempts','assessment_skill_results',
                    'practice_history','proof_results','evidence_reports')
order by tablename, cmd, policyname;
```

Expected: policies target only `authenticated`; owner checks use `auth.uid()`. No authenticated UPDATE policy for `proof_results`; its insert check requires unverified/null score/null date. No anonymous/public policy.

### Effective table privileges

```sql
select t.table_name,
       has_table_privilege('anon', format('public.%I', t.table_name), 'SELECT') as anon_select,
       has_table_privilege('anon', format('public.%I', t.table_name), 'INSERT') as anon_insert,
       has_table_privilege('authenticated', format('public.%I', t.table_name), 'SELECT') as auth_select,
       has_table_privilege('authenticated', format('public.%I', t.table_name), 'INSERT') as auth_insert,
       has_table_privilege('authenticated', format('public.%I', t.table_name), 'UPDATE') as auth_update,
       has_table_privilege('authenticated', format('public.%I', t.table_name), 'DELETE') as auth_delete
from (values ('user_profiles'), ('assessment_attempts'), ('assessment_skill_results'),
             ('practice_history'), ('proof_results'), ('evidence_reports')) as t(table_name)
order by t.table_name;
```

Expected from this migration: all `anon_*` are false; all authenticated privileges are true. The latter confirms the direct-write/own-score risk and should be narrowed before production use.

### Constraints and indexes

```sql
select conrelid::regclass as child_table, conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where contype = 'f' and connamespace = 'public'::regnamespace
order by child_table::text, conname;

select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('user_profiles','assessment_attempts','assessment_skill_results',
                    'practice_history','proof_results','evidence_reports')
order by tablename, indexname;
```

Expected: foreign keys to `auth.users` and owner-matched attempt relationships, with declared cascades; index output should reveal missing child lookup indexes on skill results and practice history.

### Score snapshot consistency

```sql
select a.id, a.user_id, a.overall_score, count(s.id) as criterion_count,
       coalesce(sum(s.weight), 0) as weight_total,
       round(coalesce(sum(s.score * s.weight), 0) / 100.0) as calculated_score
from public.assessment_attempts a
left join public.assessment_skill_results s
  on s.attempt_id = a.id and s.user_id = a.user_id
group by a.id, a.user_id, a.overall_score
having count(s.id) <> 5
    or coalesce(sum(s.weight), 0) <> 100
    or round(coalesce(sum(s.score * s.weight), 0) / 100.0) <> a.overall_score;
```

Expected for RPC-generated rows: no results. A clean result is not proof of integrity because authenticated users can currently update or create their own rows directly.

### Parent ownership consistency

```sql
select 'assessment_skill_results' as child, count(*) as mismatches
from public.assessment_skill_results s
left join public.assessment_attempts a on a.id = s.attempt_id
where a.id is null or a.user_id <> s.user_id
union all
select 'practice_history', count(*)
from public.practice_history h
left join public.assessment_attempts a on a.id = h.attempt_id
where a.id is null or a.user_id <> h.user_id
union all
select 'proof_results', count(*)
from public.proof_results p
left join public.assessment_attempts a on a.id = p.attempt_id
where a.id is null or a.user_id <> p.user_id
union all
select 'evidence_reports', count(*)
from public.evidence_reports r
left join public.assessment_attempts a on a.id = r.attempt_id
where a.id is null or a.user_id <> r.user_id;
```

Expected: four rows, each with zero mismatches. This checks stored relationships, not API authorization.

### API-level isolation test plan (not performed)

Create disposable users A and B and one disposable A-owned attempt. Through the authenticated API/JWT, expect A to read their row, B to read zero rows and be unable to update/delete A's row, an A-authenticated insert claiming B to fail, and anonymous reads/writes to fail. Also confirm that A can currently update A's own score (known failing integrity control). Use disposable rows and remove only those test fixtures after the test.

## 7. Final readiness decision

**NOT READY to apply to the existing project.** Before migration approval, remove direct client mutation of score-bearing records, enforce writes and score consistency through a trusted boundary, bind report references to their attempts, address function/trigger/table-name collision and rerun behavior, add missing child FK indexes if scale warrants, then run PostgreSQL migration and two-user/anonymous RLS tests on staging. This audit changed only this report.
