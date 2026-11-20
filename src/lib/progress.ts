import type { AssessmentRecord, ChallengeId } from '../types';

export type AssessmentMode = 'assessment' | 'practice' | 'proof';
export interface AssessmentProgress { challengeId: ChallengeId; mode: AssessmentMode; latest: AssessmentRecord; previous: AssessmentRecord | null; change: number | null }

/** A lack of prior attempts is represented as null, never as fabricated improvement. */
export function calculateAssessmentProgress(records: AssessmentRecord[], mode: AssessmentMode = 'assessment'): AssessmentProgress[] {
  const byChallenge = new Map<ChallengeId, AssessmentRecord[]>();
  for (const record of records) {
    if ((record.mode ?? 'assessment') !== mode) continue;
    byChallenge.set(record.challengeId, [...(byChallenge.get(record.challengeId) ?? []), record]);
  }
  return [...byChallenge.entries()].map(([challengeId, attempts]) => {
    const ordered = attempts.slice().sort((a, b) => Date.parse(b.evaluation.completedAt) - Date.parse(a.evaluation.completedAt));
    const latest = ordered[0];
    const previous = ordered[1] ?? null;
    return { challengeId, mode, latest, previous, change: previous ? latest.evaluation.score - previous.evaluation.score : null };
  });
}
