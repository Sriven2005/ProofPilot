import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const bootstrap = await readFile('supabase/migrations/202611180001_phase2_progress_foundation.sql', 'utf8');
const hardening = await readFile('supabase/migrations/202611180002_phase2_1_security_hardening.sql', 'utf8');
const tables = ['user_profiles', 'assessment_attempts', 'assessment_skill_results', 'practice_history', 'proof_results', 'evidence_reports'];

for (const table of tables) {
  assert.match(bootstrap, new RegExp(`create table public\\.${table}\\b`), `${table} is created without IF NOT EXISTS`);
  assert.match(bootstrap, new RegExp(`alter table public\\.${table} enable row level security`), `${table} enables RLS`);
}
assert.match(bootstrap, /to_regclass\('public\.' \|\| object_name\) is not null/, 'Bootstrap refuses existing table names before DDL.');
assert.match(bootstrap, /to_regprocedure\('public\.save_assessment_attempt\(jsonb,text\)'\) is not null/, 'Bootstrap refuses function collisions.');
assert.doesNotMatch(bootstrap, /create\s+or\s+replace|drop\s+trigger|create\s+table\s+if\s+not\s+exists|create\s+policy\s+if\s+not\s+exists/i,
  'Bootstrap does not replace/drop existing routines/triggers or silently reuse tables.');
assert.match(bootstrap, /user_id\s*=\s*\(select auth\.uid\(\)\)/, 'Initial owner policies bind rows to auth.uid().');
assert.match(bootstrap, /security invoker/i, 'The legacy RPC is not a security-definer escalation path.');
assert.match(bootstrap, /grant execute on function public\.save_assessment_attempt\(jsonb, text\) to authenticated/, 'Legacy RPC grant exists in bootstrap and is revoked by hardening.');

assert.match(hardening, /Phase 2\.1 was already applied[^\n]*before/i, 'Rerun guard names the already-installed function before changes.');
assert.match(hardening, /alter policy[\s\S]*current_user <> 'authenticated'/i, 'Write policies block direct authenticated-role writes.');
assert.match(hardening, /revoke all on public\.assessment_attempts[\s\S]*from authenticated/i, 'Direct table privileges are removed from authenticated.');
assert.match(hardening, /revoke all on public\.assessment_attempts[\s\S]*from anon, public/i, 'Anonymous and PUBLIC table privileges are revoked.');
assert.match(hardening, /revoke insert \(%1\$I\), update \(%1\$I\)[\s\S]*from authenticated/i, 'Column-level writes are revoked too.');
assert.match(hardening, /revoke all on function public\.save_assessment_attempt\(jsonb, text\) from public, anon, authenticated/i, 'Unsafe legacy RPC is disabled.');
assert.match(hardening, /security definer[\s\S]*set search_path = ''/i, 'Versioned save RPC uses a fixed empty search path.');
assert.match(hardening, /v_user_id uuid := \(select auth\.uid\(\)\)/, 'Versioned RPC derives its owner from the session.');
assert.doesNotMatch(hardening, /p_attempt\s*->>\s*'user_id'/i, 'RPC never accepts ownership from the payload.');
assert.match(hardening, /v_mode not in \('assessment', 'practice'\)/, 'Candidate RPC cannot create proof-mode attempts.');
assert.match(hardening, /v_score, 'client_unverified'/, 'Saved client-side scores are labeled unverified.');
assert.match(hardening, /v_weight_total <> 100 or v_calculated_score <> v_score/, 'RPC rejects internally inconsistent score arithmetic.');
assert.match(hardening, /a\.report_reference = v_report_reference/, 'Repeated report references are idempotent per owner.');
assert.match(hardening, /a\.legacy_source_id = p_legacy_source_id/, 'Legacy source IDs are checked for duplicate imports.');
assert.doesNotMatch(hardening, /create\s+or\s+replace\s+function|drop\s+policy|drop\s+trigger|drop\s+table/i,
  'Hardening does not overwrite/drop existing SQL objects.');
assert.match(hardening, /grant execute on function public\.save_assessment_attempt_v2\(jsonb, text\) to authenticated/, 'Only the versioned RPC is granted to authenticated.');
assert.match(hardening, /verification_status='unverified'[\s\S]*verified_score is null[\s\S]*verified_at is null/i, 'Candidate-role proof inserts remain unverified only.');
assert.doesNotMatch(hardening, /alter policy[^;]+proof_results[^;]+for update|create policy[^;]+proof_results[^;]+for update/i, 'No authenticated proof-result update policy is added.');

const repo = await readFile('src/lib/assessmentRepository.ts', 'utf8');
assert.match(repo, /rpc\('save_assessment_attempt_v2'/, 'Application uses the hardened RPC.');
assert.match(repo, /score_trust/, 'Application retrieves stored score trust metadata.');
console.log('Database security migration contract tests passed (static assertions; no PostgreSQL execution).');
