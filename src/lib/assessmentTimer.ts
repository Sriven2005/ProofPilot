export interface AssessmentTimebox {
  startedAt: number | null;
  deadlineAt: number | null;
}

export const GUIDED_ASSESSMENT_DURATION_MS = 45 * 60 * 1000;
export const SQL_ASSESSMENT_DURATION_MS = 35 * 60 * 1000;

export function startOrResumeTimebox<T extends AssessmentTimebox>(draft: T, now: number, durationMs: number): T {
  const startedAt = draft.startedAt;
  const deadlineAt = draft.deadlineAt;
  if (Number.isFinite(startedAt) && Number.isFinite(deadlineAt) && startedAt !== null && deadlineAt !== null && deadlineAt >= startedAt && startedAt <= now) return draft;
  return { ...draft, startedAt: now, deadlineAt: now + durationMs };
}

export function remainingSeconds(deadlineAt: number | null, now: number): number | null {
  if (deadlineAt === null || !Number.isFinite(deadlineAt)) return null;
  return Math.max(0, Math.ceil((deadlineAt - now) / 1000));
}

export function formatRemainingTime(seconds: number | null): string {
  if (seconds === null) return '--:--';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}
