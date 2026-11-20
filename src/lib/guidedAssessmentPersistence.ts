import type { GuidedQueryEvidence } from '../types';

export const GUIDED_DRAFT_KEY = 'proofpilot.guided-analyst-draft.v1';
export interface GuidedAssessmentDraft {
  candidate: string;
  understanding: string;
  observations: string;
  interpretation: string;
  recommendations: string;
  reasoning: string;
  query: string;
  queries: GuidedQueryEvidence[];
  currentStep: number;
  startedAt: number | null;
  deadlineAt: number | null;
}

export const emptyGuidedDraft = (): GuidedAssessmentDraft => ({ candidate: '', understanding: '', observations: '', interpretation: '', recommendations: '', reasoning: '', query: "SELECT strftime('%Y-%m', order_date) AS month, ROUND(SUM(revenue), 2) AS revenue FROM retail_sales GROUP BY month ORDER BY month;", queries: [], currentStep: 0, startedAt: null, deadlineAt: null });

export function parseGuidedAssessmentDraft(raw: string | null): GuidedAssessmentDraft {
  const empty = emptyGuidedDraft();
  if (!raw) return empty;
  try {
    const value = JSON.parse(raw) as Partial<GuidedAssessmentDraft>;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return empty;
    const queries: GuidedQueryEvidence[] = [];
    if (Array.isArray(value.queries)) {
      for (const item of value.queries) {
        if (item && typeof item === 'object' && 'sql' in item && typeof item.sql === 'string' && 'status' in item && (item.status === 'success' || item.status === 'error') && 'columns' in item && Array.isArray(item.columns) && 'rows' in item && Array.isArray(item.rows)) queries.push(item as GuidedQueryEvidence);
      }
      queries.splice(0, Math.max(0, queries.length - 10));
    }
    return {
      candidate: typeof value.candidate === 'string' ? value.candidate.slice(0, 80) : '',
      understanding: typeof value.understanding === 'string' ? value.understanding.slice(0, 10_000) : '',
      observations: typeof value.observations === 'string' ? value.observations.slice(0, 10_000) : '',
      interpretation: typeof value.interpretation === 'string' ? value.interpretation.slice(0, 10_000) : '',
      recommendations: typeof value.recommendations === 'string' ? value.recommendations.slice(0, 10_000) : '',
      reasoning: typeof value.reasoning === 'string' ? value.reasoning.slice(0, 10_000) : '',
      query: typeof value.query === 'string' ? value.query.slice(0, 20_000) : empty.query,
      queries,
      currentStep: Number.isInteger(value.currentStep) ? Math.max(0, Math.min(5, Number(value.currentStep))) : 0,
      startedAt: Number.isFinite(value.startedAt) ? Number(value.startedAt) : null,
      deadlineAt: Number.isFinite(value.deadlineAt) ? Number(value.deadlineAt) : null,
    };
  } catch { return empty; }
}

export function readGuidedAssessmentDraft(): GuidedAssessmentDraft {
  try { return parseGuidedAssessmentDraft(localStorage.getItem(GUIDED_DRAFT_KEY)); }
  catch { return emptyGuidedDraft(); }
}

export function writeGuidedAssessmentDraft(draft: GuidedAssessmentDraft): void {
  localStorage.setItem(GUIDED_DRAFT_KEY, JSON.stringify(draft));
}

export function clearGuidedAssessmentDraft(): void {
  localStorage.removeItem(GUIDED_DRAFT_KEY);
}
