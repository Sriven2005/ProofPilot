import { getChallenge } from '../data/challenges.ts';
import { getRubric } from '../data/rubrics.ts';
import type { Evaluation } from '../types.ts';
import type { SqlExecutionResult } from '../lib/sqlEvaluation.ts';
import { createTechnicalEvaluatorProvider, type ServerSideModelTransport, type StructuredTechnicalEvaluation, type TechnicalEvaluationRequest } from '../lib/technicalEvaluatorProvider.ts';

const excerpt=(value:unknown)=>typeof value==='string'?value.slice(0,180):String(value).slice(0,180);

export function buildSqlShadowRequest(answer:string,result:SqlExecutionResult,official:Evaluation):TechnicalEvaluationRequest {
  const challenge=getChallenge('analyst-sql-retention');
  const checks=[
    {id:'schema_executed',passed:result.schemaOk,evidence:result.schemaOk?'Submitted DDL executed.':'Submitted DDL did not execute.'},
    {id:'sample_data_loaded',passed:result.seedOk,evidence:result.seedOk?'Candidate sample data loaded.':'Candidate sample data failed to load.'},
    {id:'submitted_query_executed',passed:result.queryOk,evidence:result.queryOk?'Submitted query executed.':'Submitted query failed during execution.'},
    {id:'controlled_data_loaded',passed:Boolean(result.controlledDataOk),evidence:result.controlledDataOk?'Verifier edge-case fixture loaded.':'Verifier edge-case fixture did not load.'},
    {id:'controlled_business_result',passed:Boolean(result.controlledQueryOk),evidence:result.controlledQueryOk?'Verifier query assertions passed.':'Verifier query assertions failed.'},
    ...Object.entries(result.probes??{}).map(([id,passed])=>({id:`probe_${id}`,passed:Boolean(passed),evidence:`Verifier probe ${id}: ${passed?'passed':'failed'}.`}))
  ];
  const failed=checks.filter(check=>!check.passed);
  const rows=(result.controlledRows??result.rows??[]).slice(0,8).map(row=>Array.isArray(row)?row.slice(0,12).map(excerpt):[]);
  const queryOutput={columns:(result.controlledColumns??result.columns??[]).slice(0,12),rows};
  return {
    challengeDescription:[challenge.title,challenge.scenario,`Constraints: ${challenge.context}`,`Tasks: ${challenge.requirements.join(' ')}`].join('\n'),
    hiddenRubric:JSON.stringify(getRubric(challenge.id)),
    candidateSubmission:answer.slice(0,100_000),
    executionResults:{executed:true,schemaFindings:[...(result.findings??[]),...(result.controlledFindings??[])].slice(0,30).map(s=>s.slice(0,300)),testFailures:failed.map(check=>check.evidence),checks,queryOutput,maximumScore:official.components?.essentialGateApplied?official.score:100},
    testFailures:failed.map(check=>check.evidence),requiredDeliverables:challenge.deliverables
  };
}

export function evaluateSqlShadow(request:TechnicalEvaluationRequest,transport:ServerSideModelTransport):Promise<StructuredTechnicalEvaluation> {
  return createTechnicalEvaluatorProvider('gemini',transport).evaluate(request);
}

export type ShadowLogger=(entry:Record<string,unknown>)=>void;
export interface ShadowRunInput {requestId:string;request:TechnicalEvaluationRequest;official:Evaluation;transport:ServerSideModelTransport;logger:ShadowLogger;}
const redact=(value:string)=>value.replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g,'[redacted-email]').replace(/\b\+?\d[\d\s().-]{7,}\d\b/g,'[redacted-phone]').slice(0,500);

/** Shadow diagnostics are logged without candidate text, quoted evidence, secrets, or official-result mutation. */
export async function runSqlShadow(input:ShadowRunInput):Promise<StructuredTechnicalEvaluation|undefined> {
  const base={event:'proofpilot.gemini_shadow',requestId:input.requestId,officialScore:input.official.score};
  try {
    const diagnostic=await evaluateSqlShadow(input.request,input.transport);
    input.logger({...base,status:'complete',diagnosticScore:diagnostic.overallScore,criteria:diagnostic.criteria.map(c=>({name:c.name,weight:c.weight,score:c.score,evidence:c.evidence.map(redact),incorrectEvidence:c.incorrectEvidence.map(redact),missingRequirements:c.missingRequirements.map(redact),explanation:redact(c.explanation)})),technicalMistakes:diagnostic.technicalMistakes.map(redact),improvementRecommendations:diagnostic.improvementRecommendations.map(redact),validAlternativeApproaches:diagnostic.validAlternativeApproaches.map(redact),confidence:diagnostic.confidence,uncertainties:diagnostic.uncertainties.map(redact)});
    return diagnostic;
  } catch(error) {
    const message=error instanceof Error?error.message:'Unknown Gemini shadow error';
    const kind=error&&typeof error==='object'&&'kind' in error&&typeof error.kind==='string'?error.kind:'validation';
    input.logger({...base,status:'unavailable',kind,message});
    return undefined;
  }
}
