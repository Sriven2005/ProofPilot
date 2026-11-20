import type { Challenge, Evaluation } from '../types.ts';
import { dimensionWeights, getRubric, type DimensionName, type EvidenceRule } from '../data/rubrics.ts';

/** Provider contract for a future server-side Gemini adapter. Keys must never live here. */
export interface EvaluationProvider {
  evaluate(answer: string, challenge: Challenge): Promise<Evaluation>;
}

const names = Object.keys(dimensionWeights) as DimensionName[];
const matches = (text: string, expression: string) => {
  try {
    // Rubric evidence must occur within one sentence; a keyword from one clause cannot validate another.
    const bounded = expression.replaceAll('.{0,', '[^.!?]{0,');
    return new RegExp(bounded, 'i').test(text);
  }
  catch { return false; }
};
const unique = (items: string[]) => [...new Set(items)];

function inspectDimension(text: string, dimension: DimensionName, rules: EvidenceRule[], misconceptions: ReturnType<typeof getRubric>['misconceptions']) {
  const applicable = rules.filter((item) => item.credit > 0);
  const hitRules = applicable.filter((item) => matches(text, item.pattern));
  const relevantMisconceptions = unique(misconceptions
    .filter((item) => item.dimension === dimension && matches(text, item.pattern))
    .map((item) => item.explanation));
  const totalCredit = applicable.reduce((sum, item) => sum + item.credit, 0) || 1;
  const earnedCredit = hitRules.reduce((sum, item) => sum + item.credit, 0);
  const deductions = misconceptions
    .filter((item) => item.dimension === dimension && matches(text, item.pattern))
    .reduce((sum, item) => sum + item.deduction, 0);
  const score = Math.max(0, Math.min(100, Math.round((earnedCredit / totalCredit) * 100) - deductions));
  const evidence = hitRules.map((item) => item.rationale);
  const missing = applicable.filter((item) => !hitRules.includes(item)).map((item) => item.rationale);
  const noteParts = [
    evidence.length ? `Evidence: ${evidence.join(' ')}` : 'No specific supporting evidence was identified for this criterion.',
    relevantMisconceptions.length ? `Incorrect: ${relevantMisconceptions.join(' ')}` : '',
    missing.length ? `Missing: ${missing.slice(0, 2).join(' ')}` : '',
    deductions ? `Deducted ${deductions} points for unsupported or incorrect reasoning.` : ''
  ].filter(Boolean);
  return { score, evidence, missing, incorrect: relevantMisconceptions, note: noteParts.join(' ') };
}

export function evaluateSubmission(answer: string, challenge: Challenge): Evaluation {
  const text = answer.trim().replace(/\s+/g, ' ');
  const rubric = getRubric(challenge.evaluationRubricId);
  const completedAt = new Date().toISOString();
  if (!text) {
    const criteria = names.map((name) => ({ name, weight: dimensionWeights[name], score: 0, note: 'No response was submitted; no evidence can be credited.', evidence: [], missing: rubric.dimensions[name].map((rule) => rule.rationale), incorrect: [] }));
    return { score: 0, criteria, strengths: [], improvements: ['No response was submitted. A strong response should address each task with a supported analysis, a practical decision, and a way to validate its impact.', ...rubric.strongCandidate.split(/, (?=[a-z])/i)], summary: 'No response was submitted, so the rubric found no assessable evidence.', completedAt };
  }

  const inspected = Object.fromEntries(names.map((name) => [name, inspectDimension(text, name, rubric.dimensions[name], rubric.misconceptions)])) as Record<DimensionName, ReturnType<typeof inspectDimension>>;
  const allRules = names.flatMap((name) => rubric.dimensions[name]);
  const taskAnchors = rubric.taskEvidence.map((id) => allRules.find((item) => item.id === id)).filter((rule): rule is EvidenceRule => Boolean(rule));
  const taskHits = taskAnchors.map((rule) => matches(text, rule.pattern));
  const addressedTasks = taskHits.filter(Boolean).length;
  const taskCoverage = taskAnchors.length ? addressedTasks / taskAnchors.length : 0;

  // Task anchors belong to understanding only. Remove them from other criterion totals to prevent double counting.
  const criteria = names.map((name) => {
    const result = inspected[name];
    if (name === 'Problem understanding') {
      const missingTasks = taskAnchors.flatMap((anchor, index) => taskHits[index] ? [] : [`Task ${anchor.task + 1}: ${anchor.rationale}`]);
      const taskNotes = taskAnchors.map((anchor, index) => `${taskHits[index] ? 'Addressed' : 'Not demonstrated'} task ${anchor.task + 1}: ${anchor.rationale}`);
      return {
        name, weight: dimensionWeights[name], score: Math.round(taskCoverage * 100),
        note: `Task coverage: ${addressedTasks} of ${taskAnchors.length}. ${taskNotes.join(' ')}`,
        evidence: taskAnchors.flatMap((anchor, index) => taskHits[index] ? [anchor.rationale] : []),
        missing: missingTasks, incorrect: result.incorrect
      };
    }
    const anchorIds = new Set(rubric.taskEvidence);
    const uniqueRules = rubric.dimensions[name].filter((item) => !anchorIds.has(item.id));
    const uniqueResult = inspectDimension(text, name, uniqueRules, rubric.misconceptions);
    return { name, weight: dimensionWeights[name], score: uniqueResult.score, note: uniqueResult.note, evidence: uniqueResult.evidence, missing: uniqueResult.missing, incorrect: uniqueResult.incorrect };
  });
  const weighted = criteria.reduce((sum, item) => sum + item.score * item.weight, 0) / 100;
  const score = Math.round(Math.max(0, Math.min(100, weighted)));

  const evidence = unique(criteria.flatMap((item) => item.evidence));
  const incorrect = unique(criteria.flatMap((item) => item.incorrect));
  const missing = unique(criteria.flatMap((item) => item.missing));
  const strengths = evidence.length
    ? evidence.slice(0, 4).map((item) => `Correctly demonstrated: ${item}`)
    : ['The response did not demonstrate specific, challenge-relevant reasoning.'];
  const improvements = [
    ...incorrect.map((item) => `Incorrect reasoning: ${item}`),
    ...missing.slice(0, 3).map((item) => `Missing: ${item}`),
    ...criteria.map((item) => `Points: ${item.name} scored ${item.score}/100 (${item.weight}% weight). ${item.note}`),
    `A stronger response would demonstrate: ${rubric.strongCandidate}`
  ];
  const summary = score >= 90
    ? 'Excellent evidence: the response addresses the scenario with accurate, well-supported decisions and credible validation.'
    : score >= 75
      ? 'Strong evidence: the response applies sound reasoning and a practical approach, with some opportunities to add support or detail.'
      : score >= 55
        ? 'Reasonable evidence with material gaps. Several parts of the task are addressed, but important support, trade-offs, or validation are missing.'
        : score >= 30
          ? 'Partial evidence. The response engages with some parts of the scenario, but important tasks or technical reasoning remain incomplete.'
          : score > 0
            ? 'Limited evidence. A few relevant ideas appear, but the response does not yet support a dependable job-skill signal.'
            : 'The response did not demonstrate evidence that matches this challenge rubric.';

  return { score, criteria, strengths, improvements, summary, completedAt };
}

/** Local deterministic implementation; a Gemini provider can implement the same server-side contract later. */
export class RubricEvaluationProvider implements EvaluationProvider {
  async evaluate(answer: string, challenge: Challenge): Promise<Evaluation> {
    return evaluateSubmission(answer, challenge);
  }
}
