import type { SqlWorkspaceRun } from './sqlClient.ts';
import { SQL_ASSESSMENT_DURATION_MS, startOrResumeTimebox, type AssessmentTimebox } from './assessmentTimer.ts';

export const SQL_ASSESSMENT_DRAFT_KEY='proofpilot.sql-retention-draft.v1';
export type SqlEditorTab='schema'|'sample'|'query';
export interface SqlAssessmentRun {runAt:string;result:SqlWorkspaceRun}
export interface SqlAssessmentDraft extends AssessmentTimebox {
  candidate:string;
  schema:string;
  seed:string;
  query:string;
  reasoning:string;
  activeTab:SqlEditorTab;
  runs:SqlAssessmentRun[];
}

export const emptySqlAssessmentDraft=():SqlAssessmentDraft=>({
  candidate:'',
  schema:'-- Define customers and orders with keys, constraints, and a one-to-many relationship.',
  seed:'-- Add a repeat customer, a one-time customer, and a customer with no orders.',
  query:'-- Return one row per repeat customer with order count and total cents.',
  reasoning:'',activeTab:'schema',runs:[],startedAt:null,deadlineAt:null,
});

export function parseSqlAssessmentDraft(raw:string|null):SqlAssessmentDraft {
  const empty=emptySqlAssessmentDraft();
  if(!raw)return empty;
  try {
    const value=JSON.parse(raw) as Partial<SqlAssessmentDraft>;
    if(!value||typeof value!=='object'||Array.isArray(value))return empty;
    const runs=Array.isArray(value.runs)?value.runs.flatMap(item=>{
      if(!item||typeof item!=='object'||!('result' in item)||!('runAt' in item)||typeof item.runAt!=='string')return [];
      return [{runAt:item.runAt,result:item.result as SqlWorkspaceRun}];
    }).slice(-10):[];
    return {
      candidate:typeof value.candidate==='string'?value.candidate.slice(0,80):'',
      schema:typeof value.schema==='string'?value.schema.slice(0,30_000):empty.schema,
      seed:typeof value.seed==='string'?value.seed.slice(0,30_000):empty.seed,
      query:typeof value.query==='string'?value.query.slice(0,30_000):empty.query,
      reasoning:typeof value.reasoning==='string'?value.reasoning.slice(0,10_000):'',
      activeTab:value.activeTab==='sample'||value.activeTab==='query'?value.activeTab:'schema',
      runs,startedAt:Number.isFinite(value.startedAt)?Number(value.startedAt):null,deadlineAt:Number.isFinite(value.deadlineAt)?Number(value.deadlineAt):null,
    };
  } catch {return empty;}
}

export function readSqlAssessmentDraft():SqlAssessmentDraft {
  try {return parseSqlAssessmentDraft(localStorage.getItem(SQL_ASSESSMENT_DRAFT_KEY));}
  catch {return emptySqlAssessmentDraft();}
}

export function createTimedSqlAssessmentDraft(raw:string|null,now:number):SqlAssessmentDraft {
  return startOrResumeTimebox(parseSqlAssessmentDraft(raw),now,SQL_ASSESSMENT_DURATION_MS);
}

export function writeSqlAssessmentDraft(draft:SqlAssessmentDraft):void {
  localStorage.setItem(SQL_ASSESSMENT_DRAFT_KEY,JSON.stringify(draft));
}

export function clearSqlAssessmentDraft():void {
  localStorage.removeItem(SQL_ASSESSMENT_DRAFT_KEY);
}

export function formatSqlAssessmentAnswer(draft:Pick<SqlAssessmentDraft,'schema'|'seed'|'query'|'reasoning'>):string {
  return [`-- Schema\n${draft.schema}`,`-- Sample Data\n${draft.seed}`,`-- Query\n${draft.query}`,`-- Reasoning\n${draft.reasoning}`].join('\n\n');
}
