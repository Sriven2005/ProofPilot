/** Server-side model boundary. This browser application intentionally provides no credential or network implementation. */
export type EvaluationCriterionName = 'Problem understanding' | 'Technical correctness' | 'Reasoning and approach' | 'Practical implementation' | 'Measurement and validation';
export interface VerifiedExecutionFacts {
  executed: boolean;
  schemaFindings: string[];
  testFailures: string[];
  checks?: Array<{ id: string; passed: boolean; evidence: string }>;
  queryOutput?: unknown;
  /** Server policy ceiling for diagnostics when deterministic essential checks fail. */
  maximumScore?: number;
}
export interface TechnicalEvaluationRequest {
  challengeDescription: string;
  hiddenRubric: string;
  candidateSubmission: string;
  executionResults: VerifiedExecutionFacts;
  testFailures: string[];
  requiredDeliverables: string[];
}
export interface TechnicalCriterionResult {
  name: EvaluationCriterionName;
  weight: 15 | 20 | 25;
  score: number;
  evidence: string[];
  incorrectEvidence: string[];
  missingRequirements: string[];
  explanation: string;
}
export interface StructuredTechnicalEvaluation {
  overallScore: number;
  criteria: TechnicalCriterionResult[];
  technicalMistakes: string[];
  improvementRecommendations: string[];
  confidence: number;
  uncertainties: string[];
  validAlternativeApproaches: string[];
  executionFacts: VerifiedExecutionFacts;
}
export type ModelProvider = 'gemini' | 'groq';
export interface ServerSideModelTransport {
  complete(provider: ModelProvider, request: TechnicalEvaluationRequest): Promise<unknown>;
}
export interface TechnicalEvaluatorProvider {
  readonly provider: ModelProvider;
  evaluate(request: TechnicalEvaluationRequest): Promise<StructuredTechnicalEvaluation>;
}

const names: EvaluationCriterionName[] = ['Problem understanding','Technical correctness','Reasoning and approach','Practical implementation','Measurement and validation'];
const weights = [15,25,20,25,15];
function parseEvaluation(value: unknown, request:TechnicalEvaluationRequest): StructuredTechnicalEvaluation {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Evaluator returned no structured result');
  const raw=value as Record<string,unknown>;
  const facts=request.executionResults;
  if(!Number.isFinite(raw.overallScore)||Number(raw.overallScore)<0||Number(raw.overallScore)>100) throw new Error('Invalid suggested overall score');
  if (!Array.isArray(raw.criteria) || raw.criteria.length!==5) throw new Error('Evaluator must return five criterion results');
  const evidenceSources=[request.candidateSubmission,...facts.schemaFindings,...facts.testFailures,...(facts.checks??[]).map(check=>check.evidence)];
  const criteria=names.map((name,index)=>{
    const candidate=raw.criteria as Array<Record<string,unknown>>;
    const matches=candidate.filter(x=>x && typeof x==='object' && x.name===name);
    if(matches.length!==1) throw new Error(`Evaluator must return exactly one result for ${name}`);
    const item=matches[0];
    if (!item || !Number.isFinite(item.score) || Number(item.score)<0 || Number(item.score)>100) throw new Error(`Invalid score for ${name}`);
    const strings=(key:string)=>{
      const values=item[key];
      if(!Array.isArray(values)||values.some(x=>typeof x!=='string')) throw new Error(`Invalid ${key} for ${name}`);
      return values as string[];
    };
    if (typeof item.explanation!=='string' || !item.explanation.trim()) throw new Error(`Missing explanation for ${name}`);
    const evidence=strings('evidence'),incorrectEvidence=strings('incorrectEvidence'),missingRequirements=strings('missingRequirements');
    for(const quote of [...evidence,...incorrectEvidence]) {
      if(!quote.trim()||quote.length>300||!evidenceSources.some(source=>source.includes(quote))) throw new Error(`Unverifiable evidence for ${name}`);
    }
    if(item.explanation.length>1200||[...evidence,...incorrectEvidence,...missingRequirements].some(text=>text.length>500)) throw new Error(`Oversized feedback for ${name}`);
    return {name,weight:weights[index] as 15|20|25,score:Math.round(Number(item.score)),evidence,incorrectEvidence,missingRequirements,explanation:item.explanation};
  });
  const expectedChecks=facts.checks??[];
  if(!Array.isArray(raw.executionClaims)||raw.executionClaims.length!==expectedChecks.length) throw new Error('Evaluator must address every verifier check exactly once');
  const claims=raw.executionClaims as unknown[];
  for(const expected of expectedChecks) {
    const claim=claims.find(value=>value&&typeof value==='object'&&(value as Record<string,unknown>).id===expected.id) as Record<string,unknown>|undefined;
    if(!claim||typeof claim.passed!=='boolean'||claim.passed!==expected.passed||typeof claim.explanation!=='string'||!claim.explanation.trim()) {
      throw new Error(`Evaluator contradicted or omitted verifier check ${expected.id}`);
    }
  }
  const list=(key:string)=>{
    const value=raw[key];
    if(!Array.isArray(value)||value.some(x=>typeof x!=='string')) throw new Error(`Invalid ${key} list`);
    return value as string[];
  };
  const confidence=Number(raw.confidence);
  if (!Number.isFinite(confidence) || confidence<0 || confidence>1) throw new Error('Confidence must be between 0 and 1');
  // The model cannot replace or erase deterministic execution facts. Its suggested total is ignored.
  const uncapped=Math.round(criteria.reduce((sum,item)=>sum+item.score*item.weight,0)/100);
  if(facts.maximumScore!==undefined&&(!Number.isInteger(facts.maximumScore)||facts.maximumScore<0||facts.maximumScore>100)) throw new Error('Invalid deterministic score ceiling');
  const ceiling=facts.maximumScore??100;
  if(uncapped>ceiling) {
    const factor=ceiling/uncapped;
    for(const item of criteria) item.score=Math.floor(item.score*factor);
  }
  let overallScore=Math.round(criteria.reduce((sum,item)=>sum+item.score*item.weight,0)/100);
  while(overallScore>ceiling) {
    const target=[...criteria].sort((a,b)=>b.weight-a.weight).find(item=>item.score>0);
    if(!target) break;
    target.score--;
    overallScore=Math.round(criteria.reduce((sum,item)=>sum+item.score*item.weight,0)/100);
  }
  const technicalMistakes=list('technicalMistakes'),improvementRecommendations=list('improvementRecommendations'),uncertainties=list('uncertainties'),validAlternativeApproaches=list('validAlternativeApproaches');
  if([...technicalMistakes,...improvementRecommendations,...uncertainties,...validAlternativeApproaches].some(text=>!text.trim()||text.length>500)) throw new Error('Evaluator returned invalid or oversized feedback text');
  return {overallScore,criteria,technicalMistakes,improvementRecommendations,confidence,uncertainties,validAlternativeApproaches,executionFacts:facts};
}

/** Adapter factory receives server-owned transport only; never pass browser API keys. */
export function createTechnicalEvaluatorProvider(provider: ModelProvider, transport: ServerSideModelTransport): TechnicalEvaluatorProvider {
  return {provider, async evaluate(request) {
    const value=await transport.complete(provider,request);
    return parseEvaluation(value,request);
  }};
}
