-- ProofPilot Phase 2 foundation. Apply only after reviewing this migration.
-- Role, skill, and challenge definitions remain versioned in the application catalog.

-- This is a one-time bootstrap, not an adoption or repair migration. Refuse to
-- overwrite pre-existing objects; inspect/adopt them explicitly in a later migration.
do $phase2_preflight$
declare
  object_name text;
begin
  foreach object_name in array array[
    'user_profiles', 'assessment_attempts', 'assessment_skill_results',
    'practice_history', 'proof_results', 'evidence_reports'
  ] loop
    if to_regclass('public.' || object_name) is not null then
      raise exception 'Phase 2 bootstrap stopped: public.% already exists; inspect and adopt it explicitly.', object_name;
    end if;
  end loop;
  if to_regprocedure('public.touch_updated_at()') is not null then
    raise exception 'Phase 2 bootstrap stopped: public.touch_updated_at() already exists.';
  end if;
  if to_regprocedure('public.save_assessment_attempt(jsonb,text)') is not null then
    raise exception 'Phase 2 bootstrap stopped: public.save_assessment_attempt(jsonb,text) already exists.';
  end if;
  if exists (
    select 1 from pg_trigger t where not t.tgisinternal
      and t.tgname = 'user_profiles_touch_updated_at'
  ) then
    raise exception 'Phase 2 bootstrap stopped: trigger name user_profiles_touch_updated_at already exists.';
  end if;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any (array[
        'assessment_attempts_legacy_source_unique', 'assessment_attempts_user_completed_idx',
        'assessment_attempts_user_role_idx', 'assessment_skill_results_user_criterion_idx',
        'practice_history_user_time_idx', 'proof_results_user_verified_idx',
        'evidence_reports_user_created_idx'
      ])
  ) then
    raise exception 'Phase 2 bootstrap stopped: a relation/index name already exists in public.';
  end if;
end;
$phase2_preflight$;

create table public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger user_profiles_touch_updated_at before update on public.user_profiles
for each row execute function public.touch_updated_at();

create table public.assessment_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  report_reference text not null check (char_length(report_reference) between 1 and 120),
  challenge_id text not null check (char_length(challenge_id) between 1 and 120),
  role_id text not null check (char_length(role_id) between 1 and 80),
  assessment_mode text not null default 'assessment' check (assessment_mode in ('assessment', 'practice', 'proof')),
  candidate_name text not null default 'Candidate' check (char_length(candidate_name) <= 120),
  submitted_answer text not null check (char_length(submitted_answer) <= 200000),
  challenge_snapshot jsonb not null,
  evaluation_snapshot jsonb not null,
  overall_score smallint not null check (overall_score between 0 and 100),
  completed_at timestamptz not null,
  evaluator_version text not null default 'deterministic-v1',
  legacy_source_id text,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, report_reference)
);

create unique index assessment_attempts_legacy_source_unique
  on public.assessment_attempts(user_id, legacy_source_id)
  where legacy_source_id is not null;
create index assessment_attempts_user_completed_idx
  on public.assessment_attempts(user_id, completed_at desc);
create index assessment_attempts_user_role_idx
  on public.assessment_attempts(user_id, role_id, completed_at desc);

create table public.assessment_skill_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  attempt_id uuid not null,
  criterion_name text not null check (char_length(criterion_name) between 1 and 120),
  score smallint not null check (score between 0 and 100),
  weight numeric(5,2) not null check (weight between 0 and 100),
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  missing jsonb not null default '[]'::jsonb check (jsonb_typeof(missing) = 'array'),
  incorrect jsonb not null default '[]'::jsonb check (jsonb_typeof(incorrect) = 'array'),
  explanation text not null default '',
  created_at timestamptz not null default now(),
  unique (attempt_id, criterion_name),
  foreign key (attempt_id, user_id) references public.assessment_attempts(id, user_id) on delete cascade
);
create index assessment_skill_results_user_criterion_idx
  on public.assessment_skill_results(user_id, criterion_name, created_at desc);

-- Practice interactions are optional events attached only to practice attempts.
create table public.practice_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  attempt_id uuid not null,
  event_type text not null check (event_type in ('hint_requested', 'explanation_viewed', 'resource_opened', 'practice_submitted')),
  event_data jsonb not null default '{}'::jsonb check (jsonb_typeof(event_data) = 'object'),
  occurred_at timestamptz not null default now(),
  foreign key (attempt_id, user_id) references public.assessment_attempts(id, user_id) on delete cascade
);
create index practice_history_user_time_idx on public.practice_history(user_id, occurred_at desc);

-- Only attempts explicitly marked proof can have a verified proof result.
create table public.proof_results (
  attempt_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  verification_status text not null check (verification_status in ('verified', 'unverified')),
  verified_score smallint check (verified_score between 0 and 100),
  verified_at timestamptz,
  evidence_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence_snapshot) = 'object'),
  foreign key (attempt_id, user_id) references public.assessment_attempts(id, user_id) on delete cascade,
  check ((verification_status = 'verified' and verified_score is not null and verified_at is not null)
      or (verification_status = 'unverified' and verified_score is null and verified_at is null))
);
create index proof_results_user_verified_idx on public.proof_results(user_id, verified_at desc);

-- Private reference row; public sharing is intentionally not enabled in this phase.
create table public.evidence_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  attempt_id uuid not null unique,
  report_reference text not null,
  visibility text not null default 'private' check (visibility = 'private'),
  created_at timestamptz not null default now(),
  foreign key (attempt_id, user_id) references public.assessment_attempts(id, user_id) on delete cascade,
  unique (user_id, report_reference)
);
create index evidence_reports_user_created_idx on public.evidence_reports(user_id, created_at desc);

alter table public.user_profiles enable row level security;
alter table public.assessment_attempts enable row level security;
alter table public.assessment_skill_results enable row level security;
alter table public.practice_history enable row level security;
alter table public.proof_results enable row level security;
alter table public.evidence_reports enable row level security;

revoke all on public.user_profiles, public.assessment_attempts, public.assessment_skill_results,
  public.practice_history, public.proof_results, public.evidence_reports from anon, public;
grant select, insert, update, delete on public.user_profiles, public.assessment_attempts,
  public.assessment_skill_results, public.practice_history, public.proof_results,
  public.evidence_reports to authenticated;

create policy "profile owner can read" on public.user_profiles for select to authenticated using (user_id = (select auth.uid()));
create policy "profile owner can create" on public.user_profiles for insert to authenticated with check (user_id = (select auth.uid()));
create policy "profile owner can update" on public.user_profiles for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "profile owner can delete" on public.user_profiles for delete to authenticated using (user_id = (select auth.uid()));

create policy "owner can read attempts" on public.assessment_attempts for select to authenticated using (user_id = (select auth.uid()));
create policy "owner can create attempts" on public.assessment_attempts for insert to authenticated with check (user_id = (select auth.uid()));
create policy "owner can update attempts" on public.assessment_attempts for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "owner can delete attempts" on public.assessment_attempts for delete to authenticated using (user_id = (select auth.uid()));

create policy "owner can read skill results" on public.assessment_skill_results for select to authenticated using (user_id = (select auth.uid()));
create policy "owner can create skill results" on public.assessment_skill_results for insert to authenticated with check (user_id = (select auth.uid()) and exists (select 1 from public.assessment_attempts a where a.id = attempt_id and a.user_id = (select auth.uid())));
create policy "owner can update skill results" on public.assessment_skill_results for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and exists (select 1 from public.assessment_attempts a where a.id = attempt_id and a.user_id = (select auth.uid())));
create policy "owner can delete skill results" on public.assessment_skill_results for delete to authenticated using (user_id = (select auth.uid()));

create policy "owner can read practice history" on public.practice_history for select to authenticated using (user_id = (select auth.uid()));
create policy "owner can create practice history" on public.practice_history for insert to authenticated with check (user_id = (select auth.uid()) and exists (select 1 from public.assessment_attempts a where a.id = attempt_id and a.user_id = (select auth.uid()) and a.assessment_mode = 'practice'));
create policy "owner can update practice history" on public.practice_history for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and exists (select 1 from public.assessment_attempts a where a.id = attempt_id and a.user_id = (select auth.uid()) and a.assessment_mode = 'practice'));
create policy "owner can delete practice history" on public.practice_history for delete to authenticated using (user_id = (select auth.uid()));

create policy "owner can read proof results" on public.proof_results for select to authenticated using (user_id = (select auth.uid()));
create policy "owner can create unverified proof results" on public.proof_results for insert to authenticated with check (user_id = (select auth.uid()) and verification_status = 'unverified' and verified_score is null and verified_at is null and exists (select 1 from public.assessment_attempts a where a.id = attempt_id and a.user_id = (select auth.uid()) and a.assessment_mode = 'proof'));
-- There is intentionally no authenticated UPDATE policy: only trusted server-side verification may mark proof verified.
create policy "owner can delete proof results" on public.proof_results for delete to authenticated using (user_id = (select auth.uid()));

create policy "owner can read evidence reports" on public.evidence_reports for select to authenticated using (user_id = (select auth.uid()));
create policy "owner can create evidence reports" on public.evidence_reports for insert to authenticated with check (user_id = (select auth.uid()) and exists (select 1 from public.assessment_attempts a where a.id = attempt_id and a.user_id = (select auth.uid())));
create policy "owner can update evidence reports" on public.evidence_reports for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and exists (select 1 from public.assessment_attempts a where a.id = attempt_id and a.user_id = (select auth.uid())));
create policy "owner can delete evidence reports" on public.evidence_reports for delete to authenticated using (user_id = (select auth.uid()));

-- One transaction per assessment save. Ownership comes from auth.uid(), never the client payload.
create function public.save_assessment_attempt(p_attempt jsonb, p_legacy_source_id text default null)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_attempt_id uuid;
  v_report_reference text;
  v_completed_at timestamptz;
  v_mode text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(p_attempt) <> 'object' then raise exception 'Invalid assessment payload'; end if;
  if octet_length(p_attempt::text) > 1000000 then raise exception 'Assessment payload is too large'; end if;
  v_report_reference := p_attempt->>'report_reference';
  v_completed_at := (p_attempt->>'completed_at')::timestamptz;
  v_mode := coalesce(p_attempt->>'assessment_mode', 'assessment');
  if v_mode not in ('assessment', 'practice', 'proof') then raise exception 'Invalid assessment mode'; end if;
  if p_legacy_source_id is not null then
    select id into v_attempt_id from public.assessment_attempts
      where user_id = v_user_id and (legacy_source_id = p_legacy_source_id or report_reference = v_report_reference);
    if v_attempt_id is not null then return v_attempt_id; end if;
  end if;

  insert into public.assessment_attempts (
    user_id, report_reference, challenge_id, role_id, assessment_mode, candidate_name,
    submitted_answer, challenge_snapshot, evaluation_snapshot, overall_score, completed_at,
    evaluator_version, legacy_source_id
  ) values (
    v_user_id, v_report_reference, p_attempt->>'challenge_id', p_attempt->>'role_id', v_mode,
    coalesce(p_attempt->>'candidate_name', 'Candidate'), coalesce(p_attempt->>'submitted_answer', ''),
    p_attempt->'challenge_snapshot', p_attempt->'evaluation_snapshot',
    (p_attempt->>'overall_score')::smallint, v_completed_at,
    coalesce(p_attempt->>'evaluator_version', 'deterministic-v1'), p_legacy_source_id
  ) returning id into v_attempt_id;

  insert into public.assessment_skill_results (user_id, attempt_id, criterion_name, score, weight, evidence, missing, incorrect, explanation)
  select v_user_id, v_attempt_id, x.name, x.score, x.weight,
    coalesce(x.evidence, '[]'::jsonb), coalesce(x.missing, '[]'::jsonb),
    coalesce(x.incorrect, '[]'::jsonb), coalesce(x.note, '')
  from jsonb_to_recordset(coalesce(p_attempt->'criteria', '[]'::jsonb)) as x(
    name text, score smallint, weight numeric, evidence jsonb, missing jsonb, incorrect jsonb, note text
  );
  if (select count(*) from public.assessment_skill_results where attempt_id = v_attempt_id) <> 5 then
    raise exception 'Exactly five assessment criteria are required';
  end if;
  insert into public.evidence_reports (user_id, attempt_id, report_reference)
    values (v_user_id, v_attempt_id, v_report_reference);
  if v_mode = 'proof' then
    insert into public.proof_results (user_id, attempt_id, verification_status, verified_score, verified_at, evidence_snapshot)
    values (v_user_id, v_attempt_id, 'unverified', null, null, '{}'::jsonb);
  end if;
  return v_attempt_id;
end;
$$;
revoke all on function public.save_assessment_attempt(jsonb, text) from public, anon;
grant execute on function public.save_assessment_attempt(jsonb, text) to authenticated;

revoke all on function public.touch_updated_at() from public, anon;
