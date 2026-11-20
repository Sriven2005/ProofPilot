import { retailSalesRows } from '../data/retailSales.ts';
import type { GuidedAssessmentResult, GuidedQueryEvidence, GuidedSkillResult, Evaluation } from '../types';

export const PROBLEM_SOLVING_WEIGHTS = { understanding: 15, decomposition: 20, interpretation: 20, evidenceReasoning: 20, recommendations: 25 } as const;
export const IMPLEMENTATION_WEIGHTS = { syntax: 20, sqlConcepts: 15, resultCorrectness: 35, usefulCoverage: 20, validation: 10 } as const;
const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const unique = (values: string[]) => [...new Set(values)];
const has = (text: string, pattern: RegExp) => pattern.test(text);

function expectedMonthlyRevenue(): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of retailSalesRows) {
    const month = row.order_date.slice(0, 7);
    totals.set(month, (totals.get(month) ?? 0) + row.revenue);
  }
  return new Map([...totals].map(([month, amount]) => [month, Number(amount.toFixed(2))]));
}
function expectedDimension(dimension: 'category' | 'region'): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of retailSalesRows) totals.set(row[dimension], (totals.get(row[dimension]) ?? 0) + row.revenue);
  return new Map([...totals].map(([key, amount]) => [key.toLowerCase(), Number(amount.toFixed(2))]));
}

const monthNames: Record<string, string> = { october:'2025-10', oct:'2025-10', november:'2025-11', nov:'2025-11', december:'2025-12', dec:'2025-12', january:'2026-01', jan:'2026-01', february:'2026-02', feb:'2026-02', march:'2026-03', mar:'2026-03' };
function numericClaimSupported(text: string, queries: GuidedQueryEvidence[]): boolean {
  const monthly = queries.find(query => query.assessmentTag === 'monthly' && query.expectedMatch);
  if (!monthly) return false;
  const keyIndex = monthly.columns.findIndex(column => /month|date|period/.test(column.toLowerCase()));
  const valueIndex = monthly.columns.findIndex(column => /revenue|sales|total/.test(column.toLowerCase()));
  if (keyIndex < 0 || valueIndex < 0) return false;
  const values = new Map<string, number>();
  for (const row of monthly.rows) {
    const month = String(row[keyIndex] ?? '').slice(0, 7);
    const value = Number(row[valueIndex]);
    if (/^20\d{2}-\d{2}$/.test(month) && Number.isFinite(value)) values.set(month, value);
  }
  const percentClaims = [...text.matchAll(/(\d+(?:\.\d+)?)\s*%/g)];
  let verifiedPercentClaims = 0;
  for (const match of percentClaims) {
    const amount = Number(match[1]);
    const start = Math.max(0, (match.index ?? 0) - 100);
    const end = Math.min(text.length, (match.index ?? 0) + match[0].length + 100);
    const context = text.slice(start, end).toLowerCase();
    const references = [...context.matchAll(/\b(october|oct|november|nov|december|dec|january|jan|february|feb|march|mar)\b|\b(20\d{2}-(?:0[1-9]|1[0-2]))\b/g)];
    let pairs: Array<[string, string]> = [];
    if (references.length >= 2) {
      const resolveMonth = (reference: RegExpMatchArray) => reference[2] ?? monthNames[reference[1].toLowerCase()];
      const percentOffset = (match.index ?? 0) - start;
      const before = references.filter(reference => (reference.index ?? 0) < percentOffset);
      const after = references.filter(reference => (reference.index ?? 0) > percentOffset);
      const fromPosition = context.indexOf('from');
      const toMatch = fromPosition >= 0 ? /\bto\b/i.exec(context.slice(fromPosition + 4)) : null;
      const toPosition = toMatch ? fromPosition + 4 + toMatch.index : -1;
      const fromReference = fromPosition >= 0 && toPosition > fromPosition ? references.find(reference => (reference.index ?? -1) > fromPosition && (reference.index ?? Infinity) < toPosition) : undefined;
      const toReference = fromPosition >= 0 && toPosition > fromPosition ? references.find(reference => (reference.index ?? -1) > toPosition) : undefined;
      if (fromReference && toReference && (toReference.index ?? Infinity) < percentOffset) pairs = [[resolveMonth(toReference), resolveMonth(fromReference)]]; // target after "to", baseline after "from"
      else if (before.length && after.length) pairs = [[resolveMonth(before.at(-1)!), resolveMonth(after[0])]]; // target before %, baseline after %
      else pairs = [[resolveMonth(references[0]), resolveMonth(references[1])]];
    } else {
      const months = [...values.keys()].sort();
      pairs = months.flatMap((target, index) => months.slice(0, index).map(baseline => [target, baseline] as [string, string]));
    }
    const declining = /below|down|lower|declin|drop|dropped|fall|fell|decreas/.test(context);
    const increasing = /above|up|higher|increas|rose|grew|growth/.test(context);
    for (const [target, baseline] of pairs) {
      const targetValue = values.get(target), baselineValue = values.get(baseline);
      if (targetValue === undefined || baselineValue === undefined || baselineValue === 0) continue;
      const delta = ((targetValue - baselineValue) / baselineValue) * 100;
      if (Math.abs(Math.abs(delta) - amount) <= 1 && ((declining && delta < 0) || (increasing && delta > 0))) { verifiedPercentClaims += 1; break; }
    }
  }
  if (percentClaims.length) return verifiedPercentClaims === percentClaims.length;
  const currencyClaims = [...text.matchAll(/\$\s*(\d[\d,]*(?:\.\d{1,2})?)/g)].map(match => Number(match[1].replaceAll(',', '')));
  const revenueValues = [...values.values()];
  return currencyClaims.some(claim => revenueValues.some(value => Math.abs(value - claim) <= 1));
}

type PerformanceDimension = 'monthly' | 'category' | 'region';

function verifyForDimension(query: GuidedQueryEvidence, dimension: PerformanceDimension): boolean {
  if (query.status !== 'success' || query.truncated) return false;
  const sql = query.sql.toLowerCase();
  const columns = query.columns.map(value => value.toLowerCase());
  const amountIndex = columns.findIndex(column => /revenue|sales|total/.test(column));
  const recognized = dimension === 'monthly'
    ? /strftime|substr\s*\(\s*(?:\w+\.)?order_date|date\s*\(\s*(?:\w+\.)?order_date|group\s+by\s+(?:\w+\.)?order_date|group\s+by\s+month/.test(sql)
    : new RegExp(`group\\s+by\\s+(?:\\w+\\.)?${dimension}`).test(sql);
  if (!recognized) return false;
  const expected = dimension === 'monthly' ? expectedMonthlyRevenue() : expectedDimension(dimension);
  const keyPattern = dimension === 'monthly' ? /month|date|period/ : dimension === 'category' ? /category/ : /region/;
  const keyIndex = columns.findIndex(column => keyPattern.test(column));
  if (amountIndex < 0 || keyIndex < 0) return false;
  const output = new Map<string, number>();
  for (const row of query.rows) {
    const rawKey = String(row[keyIndex] ?? '');
    const key = (dimension === 'monthly' ? rawKey.slice(0, 7) : rawKey).toLowerCase();
    const value = Number(row[amountIndex]);
    if (!Number.isFinite(value) || !key) return false;
    output.set(key, (output.get(key) ?? 0) + value);
  }
  if (dimension === 'monthly') {
    const keys = new Set([...expected.keys(), ...output.keys()]);
    const expectedTotal = [...expected.values()].reduce((sum, value) => sum + value, 0);
    const expectedLatest = [...expected.values()].at(-1) ?? 0;
    const expectedFirst = [...expected.values()][0] ?? 0;
    const hasMonths = output.size >= 6 && output.size === expected.size;
    const totalsMatch = Math.abs([...output.values()].reduce((sum, value) => sum + value, 0) - expectedTotal) < 1;
    const correctTrend = [...keys].length === expected.size && [...expected].every(([month, value]) => Math.abs((output.get(month) ?? Number.NaN) - value) < 1) && expectedLatest < expectedFirst;
    return hasMonths && totalsMatch && correctTrend;
  }
  const allKeys = new Set([...expected.keys(), ...output.keys()]);
  return allKeys.size === expected.size && [...expected].every(([key, value]) => Math.abs((output.get(key) ?? Number.NaN) - value) < 1);
}

function classifyAndVerify(query: GuidedQueryEvidence): GuidedQueryEvidence {
  if (query.status !== 'success') return { ...query, assessmentTag: 'other', expectedMatch: false };
  const sql = query.sql.toLowerCase();
  let tag: GuidedQueryEvidence['assessmentTag'] = 'other';
  if (/group\s+by\s+(?:\w+\.)?category/.test(sql)) tag = 'category';
  else if (/group\s+by\s+(?:\w+\.)?region/.test(sql)) tag = 'region';
  else if (/strftime|substr\s*\(\s*(?:\w+\.)?order_date|date\s*\(\s*(?:\w+\.)?order_date|group\s+by\s+(?:\w+\.)?order_date|group\s+by\s+month/.test(sql)) tag = 'monthly';
  return { ...query, assessmentTag: tag, expectedMatch: tag !== 'other' && verifyForDimension(query, tag) };
}

/** Returns execution evidence annotated against this challenge's deterministic result checks. */
export function verifyDataAnalystQuery(query: GuidedQueryEvidence): GuidedQueryEvidence {
  return classifyAndVerify(query);
}

export function hasRetailDatasetExploration(queries: GuidedQueryEvidence[]): boolean {
  return queries.some(query => query.status === 'success' && /\bfrom\s+(?:main\.)?retail_sales\b/i.test(query.sql));
}

export function hasVerifiedPerformanceBreakdown(queries: GuidedQueryEvidence[]): boolean {
  return (['monthly', 'category', 'region'] as const).every(dimension => queries.some(query => verifyForDimension(query, dimension)));
}

function weighted(values: number[], weights: number[]): number {
  return clamp(values.reduce((sum, value, index) => sum + value * weights[index], 0) / 100);
}

export interface DataAnalystSubmission {
  candidate: string;
  understanding: string;
  observations: string;
  interpretation: string;
  recommendations: string;
  reasoning?: string;
  queries: GuidedQueryEvidence[];
}

export function evaluateDataAnalystAssessment(input: DataAnalystSubmission): Evaluation {
  const queries = input.queries.map(classifyAndVerify);
  const successes = queries.filter(query => query.status === 'success');
  const matches = successes.filter(query => query.expectedMatch);
  const completeResults = (['monthly', 'category', 'region'] as const).filter(dimension => successes.some(query => verifyForDimension(query, dimension))).length;
  const allText = [input.understanding, input.observations, input.interpretation, input.recommendations, input.reasoning ?? ''].join('\n').trim();
  const normalized = allText.toLowerCase();
  const trendEvidence = has(normalized, /(?:declin|fell|drop|decreas|downward|lower).{0,70}(?:sales|revenue|month|period)|(?:sales|revenue).{0,70}(?:declin|fell|drop|decreas|downward|lower)/);
  const periodEvidence = has(normalized, /three months|last three|monthly|month.over.month|month to month|october|november|december|january|february|march|202[56]-0[1-3]/);
  const comparisonEvidence = has(normalized, /compare|comparison|versus|vs\.?|baseline|prior period|previous month|year.over.year|trend/);
  const decompositionEvidence = completeResults >= 2 || has(normalized, /(?:region|regional).{0,90}(?:category|product)|(?:category|product).{0,90}(?:region|regional)|segment|break down|decompos/);
  const outputEvidence = matches.length > 0;
  const numericEvidence = numericClaimSupported(normalized, matches);
  const hasNumericClaim = /\d+(?:\.\d+)?\s*%|\$\s*\d/.test(normalized);
  const unsupportedQuantification = hasNumericClaim && !numericEvidence;
  const uncertaintyEvidence = has(normalized, /may|might|possible|possibly|could|hypothes|assum|not prove|cannot conclude|correlat|causal|cause needs|test whether/);
  const causalClaim = has(normalized, /because|caused by|due to|driven by|the cause is|proves/);
  const recommendationText = input.recommendations.toLowerCase();
  const unqualifiedRecommendationCause = has(recommendationText, /because|caused by|due to|driven by|will reverse|will fix/) && !has(recommendationText, /may|might|possible|hypothes|not prove|could|test whether|if .* then/);
  const contradictoryTrend = has(normalized, /(?:sales|revenue).{0,45}(?:increas|rose|grew|improv|upward)|(?:increas|rose|grew|improv|upward).{0,45}(?:sales|revenue)/) && matches.some(query => query.assessmentTag === 'monthly' && query.expectedMatch);
  const causeEvidence = has(normalized, /discount|promotion|price|region|category|product|quantity|units|demand/);
  const actionEvidence = has(normalized, /recommend|test|pilot|investigat|prioriti[sz]e|review|adjust|target|reduce|monitor|launch|action/);
  const linkedEvidence = has(normalized, /because|based on|given|as .* (?:fell|declin|drop|increas)|if .* then|for .* region|for .* category/);
  const metricEvidence = has(normalized, /metric|measure|track|monitor|conversion|revenue|margin|units|repeat|target|kpi|success/);
  const prioritizationEvidence = has(normalized, /prioriti[sz]|steepest|largest|greatest|most affected|rank/);
  const testPlanEvidence = has(normalized, /pilot|holdout|controlled|test|experiment/);
  const timeframeEvidence = has(normalized, /\b\d+[- ]?(?:day|week|month)|four[- ]week|quarter|evaluation window/);
  const guardrailEvidence = has(normalized, /guardrail|margin|stock availability|refund|quality|customer complaints/);

  // Each step is a transparent evidence ladder. Query-result credit requires executed, verified output;
  // prose alone cannot claim the candidate's query returned a result.
  const understanding = input.understanding.trim() ? clamp((trendEvidence ? 40 : 0) + (periodEvidence ? 30 : 0) + (comparisonEvidence ? 30 : 0)) : 0;
  const decomposition = clamp((completeResults * 30) + (decompositionEvidence ? 20 : 0) + (successes.length >= 3 ? 20 : successes.length >= 1 ? 10 : 0));
  let interpretation = clamp((outputEvidence ? 35 : 0) + (trendEvidence ? 25 : 0) + (numericEvidence ? 20 : 0) + (periodEvidence ? 20 : 0));
  if (contradictoryTrend) interpretation = Math.min(interpretation, 20);
  if (unsupportedQuantification) interpretation = Math.min(interpretation, 45);
  let evidenceReasoning = clamp((causeEvidence ? 25 : 0) + (uncertaintyEvidence ? 35 : 0) + (causalClaim ? (uncertaintyEvidence ? 20 : 0) : (causeEvidence && outputEvidence ? 20 : 0)) + (outputEvidence ? 20 : 0));
  if (!outputEvidence) evidenceReasoning = Math.min(evidenceReasoning, 55);
  if (causalClaim && !uncertaintyEvidence) evidenceReasoning = Math.min(evidenceReasoning, 25);
  let recommendations = clamp((actionEvidence ? 30 : 0) + (linkedEvidence ? 25 : 0) + (metricEvidence ? 25 : 0) + (uncertaintyEvidence ? 10 : 0) + (causeEvidence ? 10 : 0) - (unqualifiedRecommendationCause ? 30 : 0));
  if (!outputEvidence) recommendations = Math.min(recommendations, 45);
  const problemSolvingScore = weighted([understanding, decomposition, interpretation, evidenceReasoning, recommendations], [15, 20, 20, 20, 25]);

  const totalAttempts = queries.length;
  const syntax = totalAttempts ? clamp(successes.length / totalAttempts * 100) : 0;
  const sqlConcepts = clamp(((successes.some(q => /group\s+by/.test(q.sql.toLowerCase())) ? 1 : 0)
    + (successes.some(q => /sum\s*\(/.test(q.sql.toLowerCase())) ? 1 : 0)
    + (successes.some(q => /order_date/.test(q.sql.toLowerCase())) ? 1 : 0)) / 3 * 100);
  const resultCorrectness = clamp((completeResults / 3) * 100);
  const usefulCoverage = clamp((new Set(successes.map(q => q.sql.trim().toLowerCase())).size > 0 ? completeResults / 3 : 0) * 100);
  const validation = clamp((successes.length >= 2 ? 50 : 0) + (matches.length >= 2 ? 50 : 0));
  const implementationScore = weighted([syntax, sqlConcepts, resultCorrectness, usefulCoverage, validation], [20, 15, 35, 20, 10]);

  const skill = (name: GuidedSkillResult['skill'], score: number, evidence: string[], gaps: string[]): GuidedSkillResult => ({ skill: name, score: clamp(score), evidence: unique(evidence), gaps: unique(gaps) });
  const skillBreakdown: GuidedSkillResult[] = [
    skill('SQL', implementationScore, matches.map(query => `Executed ${query.assessmentTag} aggregation matched the dataset.`), [totalAttempts === 0 ? 'No SQL was run.' : '', successes.length < totalAttempts ? 'Some submitted queries did not execute.' : '', completeResults < 3 ? 'Run and validate monthly, category, and regional analyses.' : ''].filter(Boolean)),
    skill('Data analysis', clamp((completeResults / 3) * 55 + (decompositionEvidence ? 20 : 0) + (outputEvidence ? 25 : 0)), completeResults ? [`Verified ${completeResults} of 3 analytical result groups.`] : [], completeResults < 3 ? ['Verify monthly, category, and regional results against query output.'] : []),
    skill('Statistical interpretation', clamp((numericEvidence ? 25 : 0) + (comparisonEvidence ? 25 : 0) + (uncertaintyEvidence ? 25 : 0) + (outputEvidence ? 25 : 0)), [numericEvidence && outputEvidence ? 'Interpretation includes a numeric claim and verified query evidence.' : ''].filter(Boolean), [!numericEvidence ? 'Quantify a change using a verified result and clear baseline.' : '', !uncertaintyEvidence ? 'Separate observed association from a causal explanation.' : ''].filter(Boolean)),
    skill('Problem-solving', problemSolvingScore, [trendEvidence ? 'Identifies the sales trend.' : '', completeResults >= 2 ? 'Decomposes performance across multiple dimensions.' : ''].filter(Boolean), [!prioritizationEvidence ? 'Prioritize the next investigation using the strongest observed signal.' : '', !testPlanEvidence ? 'Turn possible causes into testable hypotheses.' : ''].filter(Boolean)),
    skill('Business communication', recommendations, [actionEvidence && linkedEvidence ? 'Recommendation is connected to a stated finding.' : ''].filter(Boolean), [!actionEvidence || !linkedEvidence ? 'State a concrete action and connect it to observed evidence.' : '', !metricEvidence ? 'Define a success measure.' : '', !timeframeEvidence ? 'Add an evaluation window.' : '', !guardrailEvidence ? 'Name a margin, customer, or operational guardrail.' : ''].filter(Boolean)),
  ];

  const criteria = [
    { name: 'Problem understanding', weight: 15, score: understanding, evidence: trendEvidence ? ['Names the declining sales/revenue problem.'] : [], missing: periodEvidence ? [] : ['State the time period and comparison baseline.'], incorrect: [] },
    { name: 'Analytical decomposition', weight: 20, score: decomposition, evidence: completeResults ? [`${completeResults} analytical result groups were verified from executed SQL.`] : [], missing: completeResults < 3 ? ['Verify monthly, category, and regional performance.'] : [], incorrect: [] },
    { name: 'Interpretation and patterns', weight: 20, score: interpretation, evidence: outputEvidence && numericEvidence ? ['A numerical interpretation is supported by executed query output.'] : [], missing: !outputEvidence || !numericEvidence || !trendEvidence ? ['Tie the trend to verified query output and quantify it against a baseline.'] : [], incorrect: [...(causalClaim && !uncertaintyEvidence ? ['A causal statement is not supported by this synthetic observational dataset.'] : []), ...(contradictoryTrend ? ['The stated sales direction conflicts with the executed monthly result.'] : []), ...(unsupportedQuantification ? ['The stated percentage or currency value could not be verified against the executed monthly query output.'] : [])] },
    { name: 'Evidence and reasoning', weight: 20, score: evidenceReasoning, evidence: uncertaintyEvidence ? ['Distinguishes a possible explanation from established causation.'] : [], missing: !outputEvidence || !uncertaintyEvidence ? ['State which findings are observed and which explanations remain hypotheses.'] : [], incorrect: causalClaim && !uncertaintyEvidence ? ['Causal claim is not qualified or tested.'] : [] },
    { name: 'Business recommendations', weight: 25, score: recommendations, evidence: actionEvidence && linkedEvidence ? ['Proposes an action linked to a finding.'] : [], missing: [!actionEvidence || !linkedEvidence ? 'State a concrete action linked to a specific finding.' : '', !metricEvidence ? 'Define a measurable success metric.' : ''].filter(Boolean), incorrect: unqualifiedRecommendationCause ? ['The recommendation assumes an unverified cause; test the hypothesis before acting on it.'] : [] },
  ];
  const note = (item: typeof criteria[number]) => `${item.score}/100. ${item.evidence.join(' ') || 'No specific evidence was demonstrated.'}${item.incorrect.length ? ` Incorrect: ${item.incorrect.join(' ')}` : ''}${item.missing.length ? ` Missing: ${item.missing.join(' ')}` : ''}`;
  const evaluationCriteria = criteria.map(item => ({ ...item, note: note(item) }));
  const psWeighted = weighted(criteria.map(item => item.score), criteria.map(item => item.weight));
  const strengths = unique([...evaluationCriteria.flatMap(item => item.evidence), ...matches.map(item => `Verified ${item.assessmentTag} SQL result against the supplied dataset.`)]).slice(0, 8);
  const improvements = unique([...evaluationCriteria.flatMap(item => [...item.incorrect, ...item.missing]), ...queries.filter(item => item.status === 'error').map(item => `SQL execution error: ${item.error ?? 'query did not execute'}`)]).slice(0, 12);
  const guidedAssessment: GuidedAssessmentResult = {
    problemSolvingScore, implementationScore,
    problemSolvingWeights: PROBLEM_SOLVING_WEIGHTS,
    implementationWeights: IMPLEMENTATION_WEIGHTS,
    skillBreakdown, queryEvidence: queries,
    understanding: input.understanding, observations: input.observations, interpretation: input.interpretation, recommendations: input.recommendations, reasoning: input.reasoning ?? '',
  };
  return {
    // Compatibility field only: report UI renders the two independent scores and never labels this as a combined score.
    score: psWeighted, criteria: evaluationCriteria, strengths, improvements,
    summary: `Problem-Solving ${problemSolvingScore}/100; Implementation ${implementationScore}/100. These independent rubric scores are deterministic, client-side evidence and are not independently verified.`,
    completedAt: new Date().toISOString(), guidedAssessment,
  };
}

export function retailExpectedResults() {
  return { monthly: Object.fromEntries(expectedMonthlyRevenue()), category: Object.fromEntries(expectedDimension('category')), region: Object.fromEntries(expectedDimension('region')) };
}
