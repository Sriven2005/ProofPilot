import type { User } from '@supabase/supabase-js';
import { getChallenge, isChallengeId } from '../data/challenges';
import type { AssessmentRecord, ChallengeId, Evaluation, RoleId } from '../types';
import { parseAssessmentRecords } from './persistence';
import type { AssessmentMode } from './progress';
import { supabase } from './supabase';
import type { Json } from './database.types';

type SaveResult = { id: string; reportReference: string };

function requireClient() {
  if (!supabase) throw new Error('Database sync is not configured. Your browser copy remains available.');
  return supabase;
}

export async function ensureUserProfile(user: User): Promise<{ user_id: string; display_name: string }> {
  const client = requireClient();
  const suggestedName = typeof user.user_metadata?.full_name === 'string'
    ? user.user_metadata.full_name.slice(0, 120)
    : (user.email?.split('@')[0] ?? '').slice(0, 120);
  const { error: createError } = await client.from('user_profiles')
    .upsert({ user_id: user.id, display_name: suggestedName }, { onConflict: 'user_id', ignoreDuplicates: true });
  if (createError) throw createError;
  const { data, error } = await client.from('user_profiles').select('user_id,display_name').eq('user_id', user.id).single();
  if (error) throw error;
  return data;
}

function recordPayload(record: AssessmentRecord, legacySourceId?: string): Json {
  const challenge = getChallenge(record.challengeId);
  const evaluation: Evaluation = record.evaluation;
  return {
    report_reference: record.id,
    challenge_id: challenge.id,
    role_id: challenge.roleId,
    assessment_mode: 'assessment' as const,
    candidate_name: record.candidate,
    submitted_answer: record.answer,
    challenge_snapshot: challenge,
    evaluation_snapshot: evaluation,
    overall_score: evaluation.score,
    completed_at: evaluation.completedAt,
    evaluator_version: 'deterministic-v1',
    criteria: evaluation.criteria.map((criterion) => ({
      name: criterion.name,
      score: criterion.score,
      weight: criterion.weight,
      evidence: criterion.evidence,
      missing: criterion.missing,
      incorrect: criterion.incorrect,
      note: criterion.note
    })),
    ...(legacySourceId ? { legacy_source_id: legacySourceId } : {})
  } as unknown as Json;
}

export async function saveCompletedAssessment(record: AssessmentRecord): Promise<SaveResult> {
  const { data, error } = await requireClient().rpc('save_assessment_attempt_v2', { p_attempt: recordPayload(record) });
  if (error) throw error;
  if (typeof data !== 'string') throw new Error('Database did not return the saved assessment identifier.');
  return { id: data, reportReference: record.id };
}

interface StoredAttempt {
  report_reference: string;
  challenge_id: string;
  candidate_name: string;
  submitted_answer: string;
  evaluation_snapshot: unknown;
  assessment_mode: AssessmentMode;
  score_trust: 'client_unverified' | 'server_verified';
}

function storedAttemptToRecord(row: StoredAttempt): AssessmentRecord | null {
  if (!isChallengeId(row.challenge_id) || !row.report_reference) return null;
  const raw = JSON.stringify([{
    id: row.report_reference,
    challengeId: row.challenge_id,
    candidate: row.candidate_name,
    answer: row.submitted_answer,
    evaluation: row.evaluation_snapshot
  }]);
  const record = parseAssessmentRecords(raw)[0];
  return record ? { ...record, mode: row.assessment_mode, scoreTrust: row.score_trust } : null;
}

export async function getAssessmentHistory(): Promise<AssessmentRecord[]> {
  const { data, error } = await requireClient().from('assessment_attempts')
    .select('report_reference,challenge_id,candidate_name,submitted_answer,evaluation_snapshot,assessment_mode,score_trust')
    .order('completed_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).flatMap((row) => {
    const record = storedAttemptToRecord(row);
    return record ? [record] : [];
  });
}

/** Explicitly called only after the user approves import; source records are never deleted. */
export async function importLocalAssessments(records: AssessmentRecord[], consented: boolean): Promise<{ imported: number; alreadyPresent: number }> {
  if (!consented) throw new Error('Import requires explicit user consent.');
  const client = requireClient();
  const existing = await getAssessmentHistory();
  const seenIds = new Set(existing.map((record) => record.id));
  let imported = 0;
  let alreadyPresent = 0;
  for (const record of records) {
    if (seenIds.has(record.id)) { alreadyPresent += 1; continue; }
    const { error } = await client.rpc('save_assessment_attempt_v2', {
      p_attempt: recordPayload(record, record.id),
      p_legacy_source_id: record.id
    });
    if (error) throw error;
    seenIds.add(record.id);
    imported += 1;
  }
  return { imported, alreadyPresent };
}

export function roleForChallenge(challengeId: ChallengeId): RoleId {
  return getChallenge(challengeId).roleId;
}
