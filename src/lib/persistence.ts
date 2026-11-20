import { isChallengeId } from '../data/challenges.ts';
import type { AssessmentRecord, ChallengeId, CriterionScore, Evaluation, GuidedAssessmentResult, GuidedQueryEvidence, GuidedSkillResult, RoleId } from '../types';

export interface AssessmentDraft {
  challengeId: ChallengeId;
  candidate: string;
  answer: string;
}

const legacyChallengeIds: Record<RoleId, ChallengeId> = {
  analyst: 'analyst-retention',
  developer: 'developer-api-debug',
  ml: 'ml-degradation',
  designer: 'designer-onboarding'
};
const legacyRoleLabels: Record<string, RoleId> = {
  'data analyst': 'analyst',
  'software developer': 'developer',
  'ai/ml engineer': 'ml',
  'ui/ux designer': 'designer'
};
const isRoleId = (value: unknown): value is RoleId => value === 'analyst' || value === 'developer' || value === 'ml' || value === 'designer';
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const textList = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

function normalizedChallengeId(value: unknown): ChallengeId | null {
  if (isChallengeId(value)) return value;
  if (isRoleId(value)) return legacyChallengeIds[value];
  if (typeof value === 'string') {
    const normalizedRole = legacyRoleLabels[value.trim().toLowerCase()];
    if (normalizedRole) return legacyChallengeIds[normalizedRole];
  }
  return null;
}

function normalizeCriterion(value: unknown): CriterionScore | null {
  if (!isObject(value) || typeof value.name !== 'string') return null;
  const score = Number(value.score);
  const weight = Number(value.weight);
  if (!Number.isFinite(score) || !Number.isFinite(weight) || score < 0 || score > 100 || weight < 0 || weight > 100) return null;
  return {
    name: value.name,
    score: Math.round(score),
    weight,
    note: typeof value.note === 'string' ? value.note : typeof value.reason === 'string' ? value.reason : 'Saved criterion result.',
    evidence: textList(value.evidence),
    missing: textList(value.missing),
    incorrect: textList(value.incorrect)
  };
}

function normalizeEvaluation(value: unknown): Evaluation | null {
  if (!isObject(value)) return null;
  const score = Number(value.score);
  const criteria = Array.isArray(value.criteria) ? value.criteria.map(normalizeCriterion) : [];
  if (!Number.isFinite(score) || score < 0 || score > 100 || criteria.length !== 5 || criteria.some((item) => !item)) return null;
  const guided = normalizeGuidedAssessment(value.guidedAssessment);
  return {
    score: Math.round(score),
    criteria: criteria as CriterionScore[],
    strengths: textList(value.strengths),
    improvements: textList(value.improvements),
    summary: typeof value.summary === 'string' ? value.summary : 'Saved assessment evaluation.',
    completedAt: typeof value.completedAt === 'string' && !Number.isNaN(Date.parse(value.completedAt)) ? value.completedAt : new Date(0).toISOString(),
    ...(isObject(value.components) && Number.isFinite(value.components.deterministicVerification) && Number.isFinite(value.components.technicalReasoning)
      ? { components: { deterministicVerification: Math.max(0,Math.min(100,Number(value.components.deterministicVerification))), technicalReasoning: Math.max(0,Math.min(100,Number(value.components.technicalReasoning))), essentialGateApplied: value.components.essentialGateApplied === true } }
      : {}),
    ...(guided ? { guidedAssessment: guided } : {})
  };
}

function normalizeGuidedAssessment(value: unknown): GuidedAssessmentResult | null {
  if (!isObject(value)) return null;
  const problemSolvingScore = Number(value.problemSolvingScore);
  const implementationScore = Number(value.implementationScore);
  if (!Number.isFinite(problemSolvingScore) || problemSolvingScore < 0 || problemSolvingScore > 100 || !Number.isFinite(implementationScore) || implementationScore < 0 || implementationScore > 100) return null;
  if (!Array.isArray(value.skillBreakdown) || value.skillBreakdown.length !== 5 || !Array.isArray(value.queryEvidence) || value.queryEvidence.length > 10) return null;
  const skills: GuidedSkillResult[] = value.skillBreakdown.flatMap((item): GuidedSkillResult[] => {
    if (!isObject(item) || typeof item.skill !== 'string') return [];
    const score = Number(item.score);
    if (!Number.isFinite(score) || score < 0 || score > 100 || !['SQL','Data analysis','Statistical interpretation','Problem-solving','Business communication'].includes(item.skill)) return [];
    return [{ skill: item.skill as GuidedSkillResult['skill'], score: Math.round(score), evidence: textList(item.evidence), gaps: textList(item.gaps) }];
  });
  if (skills.length !== 5) return null;
  const queries: GuidedQueryEvidence[] = value.queryEvidence.flatMap((item): GuidedQueryEvidence[] => {
    if (!isObject(item) || typeof item.sql !== 'string' || (item.status !== 'success' && item.status !== 'error') || !Array.isArray(item.columns) || !item.columns.every(column => typeof column === 'string') || !Array.isArray(item.rows) || !Number.isFinite(item.rowCount)) return [];
    return [{ sql: item.sql.slice(0, 20_000), status: item.status, columns: item.columns.slice(0, 30) as string[], rows: item.rows.slice(0, 200) as unknown[][], rowCount: Math.max(0, Math.min(200, Number(item.rowCount))), ...(item.truncated === true ? { truncated: true } : {}), ...(typeof item.error === 'string' ? { error: item.error.slice(0, 500) } : {}), runAt: typeof item.runAt === 'string' ? item.runAt : '', ...(item.assessmentTag === 'monthly' || item.assessmentTag === 'category' || item.assessmentTag === 'region' || item.assessmentTag === 'other' ? { assessmentTag: item.assessmentTag } : {}), ...(typeof item.expectedMatch === 'boolean' ? { expectedMatch: item.expectedMatch } : {}) }];
  });
  if (queries.length !== value.queryEvidence.length) return null;
  const psWeights = value.problemSolvingWeights;
  const implementationWeights = value.implementationWeights;
  if (!isObject(psWeights) || !isObject(implementationWeights)) return null;
  return {
    problemSolvingScore: Math.round(problemSolvingScore), implementationScore: Math.round(implementationScore),
    problemSolvingWeights: { understanding: 15, decomposition: 20, interpretation: 20, evidenceReasoning: 20, recommendations: 25 },
    implementationWeights: { syntax: 20, sqlConcepts: 15, resultCorrectness: 35, usefulCoverage: 20, validation: 10 },
    skillBreakdown: skills, queryEvidence: queries,
    understanding: typeof value.understanding === 'string' ? value.understanding.slice(0, 10_000) : '',
    observations: typeof value.observations === 'string' ? value.observations.slice(0, 10_000) : '',
    interpretation: typeof value.interpretation === 'string' ? value.interpretation.slice(0, 10_000) : '',
    recommendations: typeof value.recommendations === 'string' ? value.recommendations.slice(0, 10_000) : ''
  };
}

/** Parse current records and migrate supported role-keyed records without throwing on corrupt storage. */
export function parseAssessmentRecords(raw: string | null): AssessmentRecord[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value): AssessmentRecord[] => {
      if (!isObject(value) || typeof value.id !== 'string' || !value.id) return [];
      const challengeId = normalizedChallengeId(value.challengeId ?? value.roleId ?? value.role);
      const evaluation = normalizeEvaluation(value.evaluation);
      if (!challengeId || !evaluation) return [];
      return [{
        id: value.id,
        candidate: typeof value.candidate === 'string' ? value.candidate : 'Candidate',
        challengeId,
        answer: typeof value.answer === 'string' ? value.answer : '',
        evaluation,
        ...(value.mode === 'assessment' || value.mode === 'practice' || value.mode === 'proof' ? { mode: value.mode } : {}),
        ...(value.scoreTrust === 'client_unverified' || value.scoreTrust === 'server_verified' ? { scoreTrust: value.scoreTrust } : {})
      }];
    });
  } catch {
    return [];
  }
}

export interface AssessmentStorageSnapshot { records: AssessmentRecord[]; unsupportedCount: number }

/** Separates importable records from opaque legacy entries without changing the stored value. */
export function inspectAssessmentStorage(raw: string | null): AssessmentStorageSnapshot {
  if (raw === null) return { records: [], unsupportedCount: 0 };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { records: [], unsupportedCount: 1 };
    const records = parseAssessmentRecords(raw);
    return { records, unsupportedCount: Math.max(0, parsed.length - records.length) };
  } catch {
    return { records: [], unsupportedCount: 1 };
  }
}

/** Appends while retaining opaque legacy rows; malformed storage is never overwritten. */
export function appendAssessmentRecordPreservingUnknown(raw: string | null, record: AssessmentRecord): string {
  if (raw === null) return JSON.stringify([record]);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error('Existing assessment storage is not valid JSON and was left unchanged.'); }
  if (!Array.isArray(parsed)) throw new Error('Existing assessment storage has an unsupported format and was left unchanged.');
  if (parsed.some((item) => isObject(item) && item.id === record.id)) return raw;
  return JSON.stringify([...parsed, record]);
}

/** Read a recoverable in-progress response; invalid draft storage is ignored. */
export function parseAssessmentDraft(raw: string | null): AssessmentDraft | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isObject(value) || typeof value.answer !== 'string') return null;
    const challengeId = normalizedChallengeId(value.challengeId ?? value.roleId ?? value.role);
    if (!challengeId) return null;
    return { challengeId, candidate: typeof value.candidate === 'string' ? value.candidate : '', answer: value.answer };
  } catch {
    return null;
  }
}

export function readAssessmentRecords(): AssessmentRecord[] {
  try { return parseAssessmentRecords(localStorage.getItem('proofpilot.assessments.v1')); }
  catch { return []; }
}

export function readAssessmentDraft(): AssessmentDraft | null {
  try { return parseAssessmentDraft(localStorage.getItem('proofpilot.draft.v1')); }
  catch { return null; }
}

export function writeAssessmentDraft(draft: AssessmentDraft): void {
  localStorage.setItem('proofpilot.draft.v1', JSON.stringify(draft));
}

export function clearAssessmentDraft(): void {
  localStorage.removeItem('proofpilot.draft.v1');
}
