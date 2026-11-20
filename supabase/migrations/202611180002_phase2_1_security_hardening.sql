-- Phase 2.1: narrow client writes and mark app-supplied scores unverified.
-- Additive and rerun-guarded for the expected Phase 2 schema; never drops data/objects.

do $phase21_column$
declare
  v_type text;
  v_nullable text;
  v_default text;
  v_constraint text;
  v_constraint_normalized text;
begin
  if to_regprocedure('public.save_assessment_attempt_v2(jsonb,text)') is not null then
    raise exception 'Phase 2.1 was already applied (or partially applied); inspect migration history before rerunning.';
  end if;
  if not exists (select 1 from pg_roles r where r.rolname=current_user and r.rolbypassrls) then
    raise exception 'Apply Phase 2.1 with the trusted database migration owner; the write RPC owner must bypass RLS.';
  end if;
  if to_regclass('public.user_profiles') is null
    or to_regclass('public.assessment_attempts') is null
    or to_regclass('public.assessment_skill_results') is null
    or to_regclass('public.practice_history') is null
    or to_regclass('public.proof_results') is null
    or to_regclass('public.evidence_reports') is null then
    raise exception 'Phase 2.1 requires the complete Phase 2 schema; no changes were made.';
  end if;
  if exists (
    select 1
      from (values
        ('user_profiles','user_id'),('user_profiles','display_name'),
        ('assessment_attempts','id'),('assessment_attempts','user_id'),('assessment_attempts','report_reference'),
        ('assessment_attempts','challenge_id'),('assessment_attempts','role_id'),('assessment_attempts','assessment_mode'),
        ('assessment_attempts','candidate_name'),('assessment_attempts','submitted_answer'),
        ('assessment_attempts','challenge_snapshot'),('assessment_attempts','evaluation_snapshot'),
        ('assessment_attempts','overall_score'),('assessment_attempts','completed_at'),('assessment_attempts','evaluator_version'),('assessment_attempts','legacy_source_id'),
        ('assessment_skill_results','user_id'),('assessment_skill_results','attempt_id'),
        ('assessment_skill_results','criterion_name'),('assessment_skill_results','score'),('assessment_skill_results','weight'),
        ('assessment_skill_results','evidence'),('assessment_skill_results','missing'),('assessment_skill_results','incorrect'),('assessment_skill_results','explanation'),
        ('practice_history','user_id'),('practice_history','attempt_id'),('practice_history','event_type'),('practice_history','event_data'),
        ('proof_results','user_id'),('proof_results','attempt_id'),('proof_results','verification_status'),
        ('proof_results','verified_score'),('proof_results','verified_at'),('proof_results','evidence_snapshot'),
        ('evidence_reports','user_id'),('evidence_reports','attempt_id'),('evidence_reports','report_reference'),('evidence_reports','visibility')
      ) as required(table_name, column_name)
     where not exists (
       select 1 from information_schema.columns c
        where c.table_schema='public' and c.table_name=required.table_name and c.column_name=required.column_name
     )
  ) then
    raise exception 'Phase 2.1 found an incompatible table shape; inspect the schema before proceeding.';
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname='public'
       and tablename in ('user_profiles','assessment_attempts','assessment_skill_results','practice_history','proof_results','evidence_reports')
       and policyname not in (
         'profile owner can read','profile owner can create','profile owner can update','profile owner can delete',
         'owner can read attempts','owner can create attempts','owner can update attempts','owner can delete attempts',
         'owner can read skill results','owner can create skill results','owner can update skill results','owner can delete skill results',
         'owner can read practice history','owner can create practice history','owner can update practice history','owner can delete practice history',
         'owner can read proof results','owner can create unverified proof results','owner can delete proof results',
         'owner can read evidence reports','owner can create evidence reports','owner can update evidence reports','owner can delete evidence reports'
       )
  ) then
    raise exception 'Unexpected policy found on a private ProofPilot table; review it before hardening.';
  end if;
  if exists (
    select 1
      from (values
        ('user_profiles','profile owner can read','SELECT'),('user_profiles','profile owner can create','INSERT'),
        ('user_profiles','profile owner can update','UPDATE'),('user_profiles','profile owner can delete','DELETE'),
        ('assessment_attempts','owner can read attempts','SELECT'),('assessment_attempts','owner can create attempts','INSERT'),
        ('assessment_attempts','owner can update attempts','UPDATE'),('assessment_attempts','owner can delete attempts','DELETE'),
        ('assessment_skill_results','owner can read skill results','SELECT'),('assessment_skill_results','owner can create skill results','INSERT'),
        ('assessment_skill_results','owner can update skill results','UPDATE'),('assessment_skill_results','owner can delete skill results','DELETE'),
        ('practice_history','owner can read practice history','SELECT'),('practice_history','owner can create practice history','INSERT'),
        ('practice_history','owner can update practice history','UPDATE'),('practice_history','owner can delete practice history','DELETE'),
        ('proof_results','owner can read proof results','SELECT'),('proof_results','owner can create unverified proof results','INSERT'),
        ('proof_results','owner can delete proof results','DELETE'),
        ('evidence_reports','owner can read evidence reports','SELECT'),('evidence_reports','owner can create evidence reports','INSERT'),
        ('evidence_reports','owner can update evidence reports','UPDATE'),('evidence_reports','owner can delete evidence reports','DELETE')
      ) as expected(table_name, policyname, expected_cmd)
      join pg_policies p on p.schemaname='public' and p.tablename=expected.table_name and p.policyname=expected.policyname
     where p.cmd <> expected.expected_cmd
  ) then
    raise exception 'A known ProofPilot policy has an unexpected command; review it manually.';
  end if;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public'
       and c.relname in ('assessment_skill_results_attempt_owner_idx','practice_history_attempt_owner_idx')
       and c.relkind <> 'i'
  ) then
    raise exception 'An index name is already used by a non-index relation; inspect it manually.';
  end if;
  if to_regprocedure('public.save_assessment_attempt(jsonb,text)') is null
    or to_regprocedure('public.touch_updated_at()') is null then
    raise exception 'Phase 2.1 requires the reviewed Phase 2 functions; inspect the existing schema.';
  end if;
  select data_type, is_nullable, column_default into v_type, v_nullable, v_default
    from information_schema.columns
   where table_schema='public' and table_name='assessment_attempts' and column_name='score_trust';
  if not found then
    alter table public.assessment_attempts add column score_trust text not null default 'client_unverified';
  elsif v_type <> 'text' or v_nullable <> 'NO' or v_default not like '%client_unverified%' then
    raise exception 'Incompatible assessment_attempts.score_trust exists; inspect it manually.';
  end if;
  select pg_get_constraintdef(c.oid) into v_constraint from pg_constraint c
   where c.conrelid='public.assessment_attempts'::regclass and c.conname='assessment_attempts_score_trust_check';
  if not found then
    alter table public.assessment_attempts add constraint assessment_attempts_score_trust_check
      check (score_trust in ('client_unverified', 'server_verified'));
  else
    v_constraint_normalized := lower(regexp_replace(v_constraint, '\s+', '', 'g'));
    if v_constraint_normalized <> 'check((score_trust=any(array[''client_unverified''::text,''server_verified''::text])))' then
      raise exception 'Incompatible score trust constraint exists; inspect it manually.';
    end if;
  end if;
end;
$phase21_column$;

alter table public.user_profiles enable row level security;
alter table public.assessment_attempts enable row level security;
alter table public.assessment_skill_results enable row level security;
alter table public.practice_history enable row level security;
alter table public.proof_results enable row level security;
alter table public.evidence_reports enable row level security;

-- Disable every browser write path before the policy/index repair steps. If a
-- later compatibility check fails, client saves fail closed until retry.
revoke all on public.user_profiles from anon, public;
grant select, insert, update, delete on public.user_profiles to authenticated;
revoke all on public.assessment_attempts, public.assessment_skill_results, public.practice_history,
  public.proof_results, public.evidence_reports from anon, public;
revoke all on public.assessment_attempts, public.assessment_skill_results, public.practice_history,
  public.proof_results, public.evidence_reports from authenticated;
do $phase21_column_grants$
declare v_row record;
begin
  for v_row in
    select table_name, column_name from information_schema.columns
     where table_schema='public'
       and table_name in ('assessment_attempts','assessment_skill_results','practice_history','proof_results','evidence_reports')
  loop
    execute format('revoke insert (%1$I), update (%1$I) on table public.%2$I from authenticated', v_row.column_name, v_row.table_name);
    execute format('revoke insert (%1$I), update (%1$I) on table public.%2$I from anon', v_row.column_name, v_row.table_name);
    execute format('revoke insert (%1$I), update (%1$I) on table public.%2$I from public', v_row.column_name, v_row.table_name);
  end loop;
end;
$phase21_column_grants$;
grant select on public.assessment_attempts, public.assessment_skill_results,
  public.practice_history, public.proof_results, public.evidence_reports to authenticated;
revoke all on function public.save_assessment_attempt(jsonb, text) from public, anon, authenticated;
revoke all on function public.touch_updated_at() from public, anon, authenticated;

-- Add child-key indexes, accepting existing names only when their columns match.
do $phase21_indexes$
declare v_definition text;
begin
  select pg_get_indexdef(c.oid) into v_definition from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='i' and c.relname='assessment_skill_results_attempt_owner_idx';
  if found then
    if position('(attempt_id, user_id)' in v_definition)=0 then raise exception 'Incompatible assessment-skill index exists.'; end if;
  else
    create index assessment_skill_results_attempt_owner_idx on public.assessment_skill_results(attempt_id, user_id);
  end if;
  select pg_get_indexdef(c.oid) into v_definition from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='i' and c.relname='practice_history_attempt_owner_idx';
  if found then
    if position('(attempt_id, user_id)' in v_definition)=0 then raise exception 'Incompatible practice-history index exists.'; end if;
  else
    create index practice_history_attempt_owner_idx on public.practice_history(attempt_id, user_id);
  end if;
end;
$phase21_indexes$;

-- Restrict all result writes to a trusted database function, not the browser role.
-- The SECURITY DEFINER RPC still binds every row to auth.uid().
do $phase21_policies$
begin
  if exists (select 1 from pg_policies where schemaname='public' and tablename='user_profiles' and policyname='profile owner can read') then
    alter policy "profile owner can read" on public.user_profiles to authenticated using (user_id=(select auth.uid()));
  else
    create policy "profile owner can read" on public.user_profiles for select to authenticated using (user_id=(select auth.uid()));
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='user_profiles' and policyname='profile owner can create') then
    alter policy "profile owner can create" on public.user_profiles to authenticated with check (user_id=(select auth.uid()));
  else
    create policy "profile owner can create" on public.user_profiles for insert to authenticated with check (user_id=(select auth.uid()));
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='user_profiles' and policyname='profile owner can update') then
    alter policy "profile owner can update" on public.user_profiles to authenticated
      using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
  else
    create policy "profile owner can update" on public.user_profiles for update to authenticated
      using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='user_profiles' and policyname='profile owner can delete') then
    alter policy "profile owner can delete" on public.user_profiles to authenticated using (user_id=(select auth.uid()));
  else
    create policy "profile owner can delete" on public.user_profiles for delete to authenticated using (user_id=(select auth.uid()));
  end if;

  if exists (select 1 from pg_policies where schemaname='public' and tablename='assessment_attempts' and policyname='owner can read attempts') then
    alter policy "owner can read attempts" on public.assessment_attempts to authenticated using (user_id=(select auth.uid()));
  else
    create policy "owner can read attempts" on public.assessment_attempts for select to authenticated using (user_id=(select auth.uid()));
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='assessment_skill_results' and policyname='owner can read skill results') then
    alter policy "owner can read skill results" on public.assessment_skill_results to authenticated using (user_id=(select auth.uid()));
  else
    create policy "owner can read skill results" on public.assessment_skill_results for select to authenticated using (user_id=(select auth.uid()));
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='practice_history' and policyname='owner can read practice history') then
    alter policy "owner can read practice history" on public.practice_history to authenticated using (user_id=(select auth.uid()));
  else
    create policy "owner can read practice history" on public.practice_history for select to authenticated using (user_id=(select auth.uid()));
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='proof_results' and policyname='owner can read proof results') then
    alter policy "owner can read proof results" on public.proof_results to authenticated using (user_id=(select auth.uid()));
  else
    create policy "owner can read proof results" on public.proof_results for select to authenticated using (user_id=(select auth.uid()));
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='evidence_reports' and policyname='owner can read evidence reports') then
    alter policy "owner can read evidence reports" on public.evidence_reports to authenticated using (user_id=(select auth.uid()));
  else
    create policy "owner can read evidence reports" on public.evidence_reports for select to authenticated using (user_id=(select auth.uid()));
  end if;

  if exists (select 1 from pg_policies where schemaname='public' and tablename='assessment_attempts' and policyname='owner can create attempts') then
    alter policy "owner can create attempts" on public.assessment_attempts to authenticated
      with check (current_user <> 'authenticated' and user_id=(select auth.uid()));
  else
    create policy "owner can create attempts" on public.assessment_attempts for insert to authenticated
      with check (current_user <> 'authenticated' and user_id=(select auth.uid()));
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='assessment_attempts' and policyname='owner can update attempts') then
    alter policy "owner can update attempts" on public.assessment_attempts to authenticated
      using (current_user <> 'authenticated' and user_id=(select auth.uid()))
      with check (current_user <> 'authenticated' and user_id=(select auth.uid()));
  else
    create policy "owner can update attempts" on public.assessment_attempts for update to authenticated
      using (current_user <> 'authenticated' and user_id=(select auth.uid()))
      with check (current_user <> 'authenticated' and user_id=(select auth.uid()));
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='assessment_attempts' and policyname='owner can delete attempts') then
    alter policy "owner can delete attempts" on public.assessment_attempts to authenticated
      using (current_user <> 'authenticated' and user_id=(select auth.uid()));
  else
    create policy "owner can delete attempts" on public.assessment_attempts for delete to authenticated
      using (current_user <> 'authenticated' and user_id=(select auth.uid()));
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='assessment_skill_results' and policyname='owner can create skill results') then
    alter policy "owner can create skill results" on public.assessment_skill_results to authenticated
      with check (current_user <> 'authenticated' and user_id=(select auth.uid()) and exists (select 1 from public.assessment_attempts a where a.id=attempt_id and a.user_id=(select auth.uid())));
  else
    create policy "owner can create skill results" on public.assessment_skill_results for insert to authenticated
      with check (current_user <> 'authenticated' and user_id=(select auth.uid()) and exists (select 1 from public.assessment_attempts a where a.id=attempt_id and a.user_id=(select auth.uid())));
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='assessment_skill_results' and policyname='owner can update skill results') then
    alter policy "owner can update skill results" on public.assessment_skill_results to authenticated
      using (current_user <> 'authenticated' and user_id=(select auth.uid()))
      with check (current_user <> 'authenticated' and user_id=(select auth.uid()) and exists (select 1 from public.assessment_attempts a where a.id=attempt_id and a.user_id=(select auth.uid())));
  else
    create policy "owner can update skill results" on public.assessment_skill_results for update to authenticated
      using (current_user <> 'authenticated' and user_id=(select auth.uid()))
      with check (current_user <> 'authenticated' and user_id=(select auth.uid()) and exists (select 1 from public.assessment_attempts a where a.id=attempt_id and a.user_id=(select auth.uid())));
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='assessment_skill_results' and policyname='owner can delete skill results') then
    alter policy "owner can delete skill results" on public.assessment_skill_results to authenticated
      using (current_user <> 'authenticated' and user_id=(select auth.uid()));
  else
    create policy "owner can delete skill results" on public.assessment_skill_results for delete to authenticated
      using (current_user <> 'authenticated' and user_id=(select auth.uid()));
  end if;

  if exists (select 1 from pg_policies where schemaname='public' and tablename='practice_history' and policyname='owner can create practice history') then
    alter policy "owner can create practice history" on public.practice_history to authenticated
      with check (current_user <> 'authenticated' and user_id=(select auth.uid()) and exists (select 1 from public.assessment_attempts a where a.id=attempt_id and a.user_id=(select auth.uid()) and a.assessment_mode='practice'));
  else
    create policy "owner can create practice history" on public.practice_history for insert to authenticated
      with check (current_user <> 'authenticated' and user_id=(select auth.uid()) and exists (select 1 from public.assessment_attempts a where a.id=attempt_id and a.user_id=(select auth.uid()) and a.assessment_mode='practice'));
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='practice_history' and policyname='owner can update practice history') then
    alter policy "owner can update practice history" on public.practice_history to authenticated
      using (current_user <> 'authenticated' and user_id=(select auth.uid()))
      with check (current_user <> 'authenticated' and user_id=(select auth.uid()) and exists (select 1 from public.assessment_attempts a where a.id=attempt_id and a.user_id=(select auth.uid()) and a.assessment_mode='practice'));
  else
    create policy "owner can update practice history" on public.practice_history for update to authenticated
      using (current_user <> 'authenticated' and user_id=(select auth.uid()))
      with check (current_user <> 'authenticated' and user_id=(select auth.uid()) and exists (select 1 from public.assessment_attempts a where a.id=attempt_id and a.user_id=(select auth.uid()) and a.assessment_mode='practice'));
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='practice_history' and policyname='owner can delete practice history') then
    alter policy "owner can delete practice history" on public.practice_history to authenticated
      using (current_user <> 'authenticated' and user_id=(select auth.uid()));
  else
    create policy "owner can delete practice history" on public.practice_history for delete to authenticated
      using (current_user <> 'authenticated' and user_id=(select auth.uid()));
  end if;

  if exists (select 1 from pg_policies where schemaname='public' and tablename='proof_results' and policyname='owner can create unverified proof results') then
    alter policy "owner can create unverified proof results" on public.proof_results to authenticated
      with check (current_user <> 'authenticated' and user_id=(select auth.uid()) and verification_status='unverified' and verified_score is null and verified_at is null and exists (select 1 from public.assessment_attempts a where a.id=attempt_id and a.user_id=(select auth.uid()) and a.assessment_mode='proof'));
  else
    create policy "owner can create unverified proof results" on public.proof_results for insert to authenticated
      with check (current_user <> 'authenticated' and user_id=(select auth.uid()) and verification_status='unverified' and verified_score is null and verified_at is null and exists (select 1 from public.assessment_attempts a where a.id=attempt_id and a.user_id=(select auth.uid()) and a.assessment_mode='proof'));
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='proof_results' and policyname='owner can delete proof results') then
    alter policy "owner can delete proof results" on public.proof_results to authenticated
      using (current_user <> 'authenticated' and user_id=(select auth.uid()));
  else
    create policy "owner can delete proof results" on public.proof_results for delete to authenticated
      using (current_user <> 'authenticated' and user_id=(select auth.uid()));
  end if;

  if exists (select 1 from pg_policies where schemaname='public' and tablename='evidence_reports' and policyname='owner can create evidence reports') then
    alter policy "owner can create evidence reports" on public.evidence_reports to authenticated
      with check (current_user <> 'authenticated' and user_id=(select auth.uid()) and exists (select 1 from public.assessment_attempts a where a.id=attempt_id and a.user_id=(select auth.uid())));
  else
    create policy "owner can create evidence reports" on public.evidence_reports for insert to authenticated
      with check (current_user <> 'authenticated' and user_id=(select auth.uid()) and exists (select 1 from public.assessment_attempts a where a.id=attempt_id and a.user_id=(select auth.uid())));
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='evidence_reports' and policyname='owner can update evidence reports') then
    alter policy "owner can update evidence reports" on public.evidence_reports to authenticated
      using (current_user <> 'authenticated' and user_id=(select auth.uid()))
      with check (current_user <> 'authenticated' and user_id=(select auth.uid()) and exists (select 1 from public.assessment_attempts a where a.id=attempt_id and a.user_id=(select auth.uid())));
  else
    create policy "owner can update evidence reports" on public.evidence_reports for update to authenticated
      using (current_user <> 'authenticated' and user_id=(select auth.uid()))
      with check (current_user <> 'authenticated' and user_id=(select auth.uid()) and exists (select 1 from public.assessment_attempts a where a.id=attempt_id and a.user_id=(select auth.uid())));
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='evidence_reports' and policyname='owner can delete evidence reports') then
    alter policy "owner can delete evidence reports" on public.evidence_reports to authenticated
      using (current_user <> 'authenticated' and user_id=(select auth.uid()));
  else
    create policy "owner can delete evidence reports" on public.evidence_reports for delete to authenticated
      using (current_user <> 'authenticated' and user_id=(select auth.uid()));
  end if;
end;
$phase21_policies$;

-- Versioned name avoids replacing an existing hosted function. The preflight
-- above makes reruns stop before changing anything; migration history owns this
-- one-time creation. The function owner must be a trusted RLS-bypass migration role.
do $phase21_function$
begin
  if to_regprocedure('public.save_assessment_attempt_v2(jsonb,text)') is not null then
    raise exception 'public.save_assessment_attempt_v2 already exists; inspect it rather than replacing it.';
  end if;
  execute $create_function$
    create function public.save_assessment_attempt_v2(p_attempt jsonb, p_legacy_source_id text default null)
    returns uuid
    language plpgsql
    security definer
    set search_path = ''
    as $body$
    declare
      v_user_id uuid := (select auth.uid());
      v_attempt_id uuid;
      v_report_reference text;
      v_challenge_id text;
      v_role_id text;
      v_completed_at timestamptz;
      v_mode text;
      v_score integer;
      v_criteria_count integer;
      v_weight_total numeric;
      v_calculated_score numeric;
    begin
      if v_user_id is null then raise exception 'Authentication required'; end if;
      if pg_catalog.jsonb_typeof(p_attempt) <> 'object' then raise exception 'Invalid assessment payload'; end if;
      if pg_catalog.octet_length(p_attempt::text) > 1000000 then raise exception 'Assessment payload is too large'; end if;
      v_report_reference := p_attempt->>'report_reference';
      v_challenge_id := p_attempt->>'challenge_id';
      v_role_id := p_attempt->>'role_id';
      v_completed_at := (p_attempt->>'completed_at')::timestamptz;
      v_mode := coalesce(p_attempt->>'assessment_mode', 'assessment');
      if v_mode not in ('assessment', 'practice') then
        raise exception 'Proof attempts require a separately trusted verification service';
      end if;
      if pg_catalog.jsonb_typeof(p_attempt->'challenge_snapshot') <> 'object'
        or pg_catalog.jsonb_typeof(p_attempt->'evaluation_snapshot') <> 'object' then
        raise exception 'Challenge and evaluation snapshots must be objects';
      end if;
      if p_attempt->'challenge_snapshot'->>'id' is distinct from v_challenge_id
        or p_attempt->'challenge_snapshot'->>'roleId' is distinct from v_role_id then
        raise exception 'Challenge snapshot identifiers do not match the attempt';
      end if;
      if (p_attempt->>'overall_score') is null
        or (p_attempt->>'overall_score') !~ '^(100|[1-9]?[0-9])$' then
        raise exception 'Invalid overall score';
      end if;
      v_score := (p_attempt->>'overall_score')::integer;
      if (p_attempt->'evaluation_snapshot'->>'score')::integer is distinct from v_score then
        raise exception 'Evaluation snapshot score does not match the attempt score';
      end if;
      if p_attempt->'evaluation_snapshot'->'criteria' is distinct from p_attempt->'criteria' then
        raise exception 'Normalized criteria do not match the evaluation snapshot';
      end if;
      if pg_catalog.jsonb_typeof(p_attempt->'criteria') <> 'array'
        or pg_catalog.jsonb_array_length(p_attempt->'criteria') <> 5 then
        raise exception 'Exactly five criteria are required';
      end if;
      select count(*)::integer,
             coalesce(sum((c.value->>'weight')::numeric), 0),
             round(coalesce(sum((c.value->>'score')::numeric * (c.value->>'weight')::numeric), 0) / 100)
        into v_criteria_count, v_weight_total, v_calculated_score
        from pg_catalog.jsonb_array_elements(p_attempt->'criteria') c;
      if v_criteria_count <> 5 or v_weight_total <> 100 or v_calculated_score <> v_score then
        raise exception 'Criterion weights or weighted score are inconsistent';
      end if;

      select a.id into v_attempt_id from public.assessment_attempts a
       where a.user_id = v_user_id and a.report_reference = v_report_reference limit 1;
      if v_attempt_id is not null then return v_attempt_id; end if;
      if p_legacy_source_id is not null then
        select a.id into v_attempt_id from public.assessment_attempts a
         where a.user_id = v_user_id and a.legacy_source_id = p_legacy_source_id limit 1;
        if v_attempt_id is not null then return v_attempt_id; end if;
      end if;

      insert into public.assessment_attempts (
        user_id, report_reference, challenge_id, role_id, assessment_mode, candidate_name,
        submitted_answer, challenge_snapshot, evaluation_snapshot, overall_score, score_trust,
        completed_at, evaluator_version, legacy_source_id
      ) values (
        v_user_id, v_report_reference, v_challenge_id, v_role_id, v_mode,
        coalesce(p_attempt->>'candidate_name', 'Candidate'), coalesce(p_attempt->>'submitted_answer', ''),
        p_attempt->'challenge_snapshot', p_attempt->'evaluation_snapshot', v_score, 'client_unverified',
        v_completed_at, coalesce(p_attempt->>'evaluator_version', 'deterministic-v1'), p_legacy_source_id
      ) returning id into v_attempt_id;

      insert into public.assessment_skill_results
        (user_id, attempt_id, criterion_name, score, weight, evidence, missing, incorrect, explanation)
      select v_user_id, v_attempt_id, c.name, c.score, c.weight,
             coalesce(c.evidence, '[]'::jsonb), coalesce(c.missing, '[]'::jsonb),
             coalesce(c.incorrect, '[]'::jsonb), coalesce(c.note, '')
        from pg_catalog.jsonb_to_recordset(p_attempt->'criteria') as c(
          name text, score smallint, weight numeric, evidence jsonb,
          missing jsonb, incorrect jsonb, note text
        );
      insert into public.evidence_reports (user_id, attempt_id, report_reference)
        values (v_user_id, v_attempt_id, v_report_reference);
      return v_attempt_id;
    exception
      when unique_violation then
        select a.id into v_attempt_id from public.assessment_attempts a
         where a.user_id = v_user_id
           and (a.report_reference = v_report_reference
             or (p_legacy_source_id is not null and a.legacy_source_id = p_legacy_source_id))
         limit 1;
        if v_attempt_id is not null then return v_attempt_id; end if;
        raise;
    end;
    $body$
  $create_function$;
  comment on function public.save_assessment_attempt_v2(jsonb, text)
    is 'ProofPilot Phase 2.1 v1: authenticated insert-only; score source is client_unverified.';
  revoke all on function public.save_assessment_attempt_v2(jsonb, text) from public, anon;
  grant execute on function public.save_assessment_attempt_v2(jsonb, text) to authenticated;
end;
$phase21_function$;
