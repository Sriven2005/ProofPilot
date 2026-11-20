import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, ViteDevServer } from 'vite';
import { parseSqlSubmission } from '../lib/sqlSubmission.ts';
import { evaluateSqlBenchmark, type SqlExecutionResult } from '../lib/sqlEvaluation.ts';
import type { ServerSideModelTransport } from '../lib/technicalEvaluatorProvider.ts';
import { buildSqlShadowRequest, runSqlShadow, type ShadowLogger } from './sqlGeminiShadow.ts';

const ENDPOINT='/api/evaluate/sql';
const RUN_ENDPOINT='/api/evaluate/sql/run';
const MAX_BODY=100_000;
const MAX_OUTPUT=1_000_000;
const TIMEOUT_MS=5_000;
let activeRuns=0;

function send(res:ServerResponse,status:number,body:unknown) {
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.end(JSON.stringify(body));
}
function readJson(req:IncomingMessage):Promise<unknown> {
  return new Promise((resolveBody,reject)=>{
    const chunks:Buffer[]=[]; let size=0;
    req.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>MAX_BODY){reject(new Error('Submission is too large.'));req.destroy();return;}chunks.push(chunk);});
    req.on('end',()=>{try{resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(new Error('Request body must be valid JSON.'));}});
    req.on('error',reject);
  });
}
function invokeSandbox(parts:{schema:string;seed:string;query:string},mode:'evaluate'|'run'='evaluate'):Promise<SqlExecutionResult|SqlRunResult> {
  return new Promise((resolveResult,reject)=>{
    const python=process.env.PROOFPILOT_PYTHON || 'python';
    const script=resolve(process.cwd(),'src/server/sqlite_sandbox.py');
    const child=spawn(python,[script],{stdio:['pipe','pipe','pipe'],windowsHide:true,shell:false});
    let stdout='',stderr='',finished=false;
    const timer=setTimeout(()=>{child.kill();finish(new Error('SQL execution exceeded the resource time limit.'));},TIMEOUT_MS);
    const finish=(error?:Error)=>{
      if(finished)return; finished=true;clearTimeout(timer);
      if(error){reject(error);return;}
      try { const value=JSON.parse(stdout);if(value.runnerError)throw new Error(value.runnerError);resolveResult(value as SqlExecutionResult); }
      catch { reject(new Error(`SQL verifier returned invalid output. ${stderr.slice(0,120)}`)); }
    };
    child.stdout.on('data',(chunk:Buffer)=>{stdout+=chunk.toString();if(stdout.length>MAX_OUTPUT){child.kill();finish(new Error('SQL verifier output exceeded its limit.'));}});
    child.stderr.on('data',(chunk:Buffer)=>{stderr+=chunk.toString().slice(0,MAX_OUTPUT-stderr.length);});
    child.on('error',()=>finish(new Error('Isolated SQLite runtime is unavailable.')));
    child.on('close',code=>code===0?finish():finish(new Error(`SQL verifier exited with status ${code}. ${stderr.slice(0,120)}`)));
    child.stdin.end(JSON.stringify({...parts,...(mode==='run'?{mode:'run'}:{})}));
  });
}
interface SqlRunResult {schemaOk:boolean;seedOk:boolean;queryOk:boolean;columns:string[];rows:unknown[][];rowCount:number;truncated:boolean;errors:Record<string,string>}
async function handle(req:IncomingMessage,res:ServerResponse,shadowEnabled:boolean,options:SqlEvaluatorPluginOptions) {
  const remote = req.socket.remoteAddress ?? '';
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) { send(res,403,{error:'This development-only evaluator is available from the local machine only.'}); return; }
  if(req.method!=='POST'){send(res,405,{error:'POST required'});return;}
  if(!req.headers['content-type']?.toLowerCase().startsWith('application/json')){send(res,415,{error:'JSON content type required'});return;}
  if(activeRuns>=2){send(res,429,{error:'SQL verifier is busy; retry shortly.'});return;}
  activeRuns++;
  try {
    const value=await readJson(req) as {challengeId?:unknown;answer?:unknown};
    if(value.challengeId!=='analyst-sql-retention'||typeof value.answer!=='string'){send(res,400,{error:'Unsupported SQL challenge submission.'});return;}
    const parts=parseSqlSubmission(value.answer);
    if(parts.schema.length>50_000||parts.seed.length>30_000||parts.query.length>30_000){send(res,413,{error:'SQL section is too large.'});return;}
    const result=await invokeSandbox({schema:parts.schema,seed:parts.seed,query:parts.query});
    const evaluation=evaluateSqlBenchmark(parts,result as SqlExecutionResult);
    send(res,200,evaluation);
    if(shadowEnabled&&options.shadowTransport) {
      const requestId=randomUUID();
      const logger=options.logger??(entry=>console.info(JSON.stringify(entry)));
      void Promise.resolve().then(()=>runSqlShadow({requestId,request:buildSqlShadowRequest(value.answer as string,result as SqlExecutionResult,evaluation),official:evaluation,transport:options.shadowTransport!,logger})).catch(()=>logger({event:'proofpilot.gemini_shadow',requestId,officialScore:evaluation.score,status:'unavailable',kind:'internal',message:'Unable to prepare shadow evaluation request.'}));
    }
  } catch(error) {
    const message=error instanceof Error?error.message:'SQL evaluation failed.';
    send(res,message.includes('too large')?413:503,{error:message});
  } finally {activeRuns--;}
}
async function handleRun(req:IncomingMessage,res:ServerResponse) {
  const remote=req.socket.remoteAddress??'';
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote)){send(res,403,{error:'SQL execution is available only from the local development machine.'});return;}
  if(req.method!=='POST'){send(res,405,{error:'POST required'});return;}
  if(!req.headers['content-type']?.toLowerCase().startsWith('application/json')){send(res,415,{error:'JSON content type required'});return;}
  if(activeRuns>=2){send(res,429,{error:'SQL runtime is busy; retry shortly.'});return;}
  activeRuns++;
  try {
    const value=await readJson(req) as {challengeId?:unknown;schema?:unknown;seed?:unknown;query?:unknown};
    if(value.challengeId!=='analyst-sql-retention'||![value.schema,value.seed,value.query].every(item=>typeof item==='string')){send(res,400,{error:'Unsupported SQL workspace request.'});return;}
    const parts={schema:value.schema as string,seed:value.seed as string,query:value.query as string};
    if(parts.schema.length>30_000||parts.seed.length>30_000||parts.query.length>30_000){send(res,413,{error:'SQL section is too large.'});return;}
    const result=await invokeSandbox(parts,'run');
    send(res,200,result);
  } catch(error) {
    const message=error instanceof Error?error.message:'SQL execution failed.';
    send(res,message.includes('too large')?413:503,{error:message});
  } finally {activeRuns--;}
}
export interface SqlEvaluatorPluginOptions {
  shadowTransport?:ServerSideModelTransport;
  logger?:ShadowLogger;
}

function install(server:ViteDevServer,shadowEnabled:boolean,options:SqlEvaluatorPluginOptions) {
  server.middlewares.use(ENDPOINT,(req,res)=>{void handle(req,res,shadowEnabled,options);});
}

/** Legacy SQL verification is local Vite-development-only. It is not installed in preview or production. */
export function sqlEvaluatorPlugin(options:SqlEvaluatorPluginOptions={}):Plugin {
  return {
    name:'proofpilot-sql-evaluator',
    configureServer(server){server.middlewares.use(RUN_ENDPOINT,(req,res)=>{void handleRun(req,res);});install(server,true,options);},
  };
}
