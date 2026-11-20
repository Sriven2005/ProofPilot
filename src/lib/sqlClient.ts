import type { ChallengeId, Evaluation } from '../types';

export interface SqlWorkspaceRun {
  schemaOk:boolean;
  seedOk:boolean;
  queryOk:boolean;
  columns:string[];
  rows:unknown[][];
  rowCount:number;
  truncated:boolean;
  errors:Record<string,string>;
}

export async function runSqlAssessment(parts:{schema:string;seed:string;query:string},challengeId:ChallengeId):Promise<SqlWorkspaceRun> {
  const response=await fetch('/api/evaluate/sql/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({challengeId,...parts})});
  const payload=await response.json() as unknown;
  if(!response.ok) {
    const message=payload&&typeof payload==='object'&&'error' in payload&&typeof payload.error==='string'?payload.error:'SQL runtime is unavailable.';
    throw new Error(message);
  }
  if(!payload||typeof payload!=='object')throw new Error('SQL runtime returned invalid data.');
  const result=payload as SqlWorkspaceRun;
  if(typeof result.schemaOk!=='boolean'||typeof result.seedOk!=='boolean'||typeof result.queryOk!=='boolean'||!Array.isArray(result.columns)||!Array.isArray(result.rows)||!Number.isInteger(result.rowCount)||typeof result.truncated!=='boolean'||!result.errors||typeof result.errors!=='object')throw new Error('SQL runtime returned an invalid result.');
  if(result.columns.length>30||result.rows.length>200||result.rows.some(row=>!Array.isArray(row)||row.length!==result.columns.length))throw new Error('SQL runtime output exceeded its safety limits.');
  return result;
}

export async function evaluateSqlAnswer(answer:string,challengeId:ChallengeId):Promise<Evaluation> {
  const response=await fetch('/api/evaluate/sql',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({challengeId,answer})});
  const payload=await response.json() as unknown;
  if(!response.ok) {
    const message=payload&&typeof payload==='object'&&'error' in payload&&typeof payload.error==='string'?payload.error:'SQL evaluation is unavailable.';
    throw new Error(message);
  }
  if(!payload||typeof payload!=='object')throw new Error('SQL evaluation returned invalid data.');
  const evaluation=payload as Evaluation;
  if(!Number.isFinite(evaluation.score)||evaluation.score<0||evaluation.score>100||!Array.isArray(evaluation.criteria)||evaluation.criteria.length!==5||evaluation.criteria.some(c=>!c||typeof c.note!=='string'))throw new Error('SQL evaluation returned an invalid assessment.');
  const calculated=Math.round(evaluation.criteria.reduce((sum,c)=>sum+c.score*c.weight,0)/100);
  if(calculated!==evaluation.score)throw new Error('SQL evaluation score did not match its criterion breakdown.');
  return evaluation;
}
