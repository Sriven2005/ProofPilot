import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { sqlEvaluatorPlugin } from '../src/server/sqlEvaluatorPlugin.ts';
import { createGeminiTransport, GeminiTransportError } from '../src/server/geminiTransport.ts';
import { runSqlShadow } from '../src/server/sqlGeminiShadow.ts';
import { createTechnicalEvaluatorProvider, type TechnicalEvaluationRequest } from '../src/lib/technicalEvaluatorProvider.ts';
import type { Evaluation } from '../src/types.ts';

const checks=[{id:'query_ok',passed:false,evidence:'Submitted query failed.'},{id:'fk_probe',passed:true,evidence:'Foreign key probe passed.'}];
const request:TechnicalEvaluationRequest={challengeDescription:'Retail repeat-customer SQL task.',hiddenRubric:'Use correct customer grain and integrity.',candidateSubmission:'Use EXISTS as an equivalent approach.',requiredDeliverables:['Schema','Query'],executionResults:{executed:true,schemaFindings:[],testFailures:['Submitted query failed.'],checks,maximumScore:100}};
const names=['Problem understanding','Technical correctness','Reasoning and approach','Practical implementation','Measurement and validation'];
function result(overrides:Record<string,unknown>={}) {
  return {overallScore:3,criteria:names.map(name=>({name,score:80,evidence:['Use EXISTS as an equivalent approach.'],incorrectEvidence:[],missingRequirements:[],explanation:`Evidence supports ${name}.`})),executionClaims:checks.map(c=>({id:c.id,passed:c.passed,explanation:c.evidence})),technicalMistakes:[],improvementRecommendations:[],validAlternativeApproaches:['A correlated EXISTS query is valid when it enforces one output row per customer.'],confidence:0.86,uncertainties:[],...overrides};
}
const response=(text:string)=>new Response(JSON.stringify({candidates:[{content:{parts:[{text}]}}]}),{status:200,headers:{'Content-Type':'application/json'}});
const official:Evaluation={score:49,criteria:names.map((name,index)=>({name,weight:[15,25,20,25,15][index],score:49,note:'Deterministic verifier failure.',evidence:[],missing:[],incorrect:['Required query failed.']})),strengths:[],improvements:['Fix query execution.'],summary:'Essential requirement failed; capped.',completedAt:'2026-11-08T00:00:00.000Z',components:{deterministicVerification:49,technicalReasoning:49,essentialGateApplied:true}};

// A well-formed model response is accepted, but its claimed overall is ignored and recomputed.
{
  let sentBody:Record<string,unknown>|undefined;
  const transport=createGeminiTransport({apiKey:'mock-secret-never-logged',model:'gemini-3.8-flash',retries:0,fetcher:async(_url,init)=>{sentBody=JSON.parse(String(init?.body));return response(JSON.stringify(result()));}});
  const evaluation=await createTechnicalEvaluatorProvider('gemini',transport).evaluate(request);
  assert.equal(evaluation.overallScore,80);
  assert.deepEqual(evaluation.criteria.map(c=>c.weight),[15,25,20,25,15]);
  assert.equal(evaluation.validAlternativeApproaches.length,1);
  assert.equal(evaluation.executionFacts,request.executionResults);
  const config=(sentBody as {generationConfig:{responseMimeType:string;responseSchema:unknown;maxOutputTokens:number}}).generationConfig;
  assert.equal(config.responseMimeType,'application/json');
  assert.ok(config.responseSchema);
  assert.ok(config.maxOutputTokens<=1800);
}

// Malformed JSON returned by Gemini is classified and does not escape as a parse exception.
{
  const transport=createGeminiTransport({apiKey:'mock',model:'gemini-3.8-flash',retries:0,fetcher:async()=>response('{bad json')});
  await assert.rejects(createTechnicalEvaluatorProvider('gemini',transport).evaluate(request),(error:unknown)=>error instanceof GeminiTransportError&&error.kind==='malformed');
}

// Schema-invalid JSON is rejected by the existing strict runtime provider contract.
{
  const provider=createTechnicalEvaluatorProvider('gemini',{complete:async()=>({overallScore:0,criteria:[],executionClaims:[],technicalMistakes:[],improvementRecommendations:[],validAlternativeApproaches:[],confidence:0.5,uncertainties:[]})});
  await assert.rejects(provider.evaluate(request),/five criterion results/);
}

// Missing credentials fail before network access.
{
  let called=false;
  const transport=createGeminiTransport({model:'gemini-3.8-flash',fetcher:async()=>{called=true;return response('{}');}});
  await assert.rejects(transport.complete('gemini',request),(error:unknown)=>error instanceof GeminiTransportError&&error.kind==='configuration');
  assert.equal(called,false);
}

// Timeout is bounded and classified.
{
  const transport=createGeminiTransport({apiKey:'mock',model:'gemini-3.8-flash',timeoutMs:1000,retries:0,fetcher:async(_url,init)=>new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new Error('aborted'))))});
  await assert.rejects(transport.complete('gemini',request),(error:unknown)=>error instanceof GeminiTransportError&&error.kind==='timeout');
}

// Quota errors get only one retry and are classified; no body is copied into logs.
{
  let calls=0;
  const transport=createGeminiTransport({apiKey:'mock',model:'gemini-3.8-flash',fetcher:async()=>{calls++;return new Response('private upstream text',{status:429});}});
  await assert.rejects(transport.complete('gemini',request),(error:unknown)=>error instanceof GeminiTransportError&&error.kind==='quota');
  assert.equal(calls,2);
}

// Contradicting or omitting verified execution results invalidates the diagnostic.
{
  const provider=createTechnicalEvaluatorProvider('gemini',{complete:async()=>result({executionClaims:[{id:'query_ok',passed:true,explanation:'Claimed success.'},{id:'fk_probe',passed:true,explanation:'Passed.'}]})});
  await assert.rejects(provider.evaluate(request),/contradicted or omitted verifier check query_ok/);
}

// Essential failure ceilings apply to the shadow diagnostic and weighted criteria stay consistent.
{
  const cappedRequest={...request,executionResults:{...request.executionResults,maximumScore:49}};
  const provider=createTechnicalEvaluatorProvider('gemini',{complete:async()=>result()});
  const evaluation=await provider.evaluate(cappedRequest);
  assert.ok(evaluation.overallScore<=49);
  assert.equal(evaluation.overallScore,Math.round(evaluation.criteria.reduce((sum,c)=>sum+c.score*c.weight,0)/100));
}

// A valid alternative is retained without an invented mistake or penalty.
{
  const provider=createTechnicalEvaluatorProvider('gemini',{complete:async()=>result({validAlternativeApproaches:['Correlated EXISTS is valid and avoids duplicate customer rows.']})});
  const evaluation=await provider.evaluate(request);
  assert.equal(evaluation.technicalMistakes.length,0);
  assert.equal(evaluation.criteria.find(c=>c.name==='Practical implementation')?.score,80);
  assert.match(evaluation.validAlternativeApproaches[0],/EXISTS/);
}

// A provider failure only logs its diagnostic failure; the official Evaluation is untouched.
{
  const before=structuredClone(official);
  const logs:Record<string,unknown>[]=[];
  const returned=await runSqlShadow({requestId:'test-request-id',request,official,transport:{complete:async()=>{throw new GeminiTransportError('quota','Gemini quota or rate limit reached.');}},logger:entry=>logs.push(entry)});
  assert.equal(returned,undefined);
  assert.deepEqual(official,before);
  assert.equal(logs[0].requestId,'test-request-id');
  assert.equal(logs[0].kind,'quota');
  assert.ok(!JSON.stringify(logs).includes('mock-secret'));
  assert.ok(!JSON.stringify(logs).includes(request.candidateSubmission));
}

// Exercise the real dev middleware: Gemini diagnostic output/failure cannot change the HTTP assessment.
{
  let failShadow=false;
  const events:Record<string,unknown>[]=[];
  let onShadow:((value:Record<string,unknown>)=>void)|undefined;
  const transport={complete:async(_provider:'gemini',input:TechnicalEvaluationRequest)=>{
    if(failShadow) throw new GeminiTransportError('network','Gemini network request failed.');
    return result({criteria:names.map(name=>({name,score:80,evidence:[input.candidateSubmission],incorrectEvidence:[],missingRequirements:[],explanation:`Evidence supports ${name}.`})),executionClaims:(input.executionResults.checks??[]).map(c=>({id:c.id,passed:c.passed,explanation:c.evidence}))});
  }};
  const server=await createServer({configFile:false,logLevel:'error',plugins:[sqlEvaluatorPlugin({shadowTransport:transport,logger:entry=>{events.push(entry);onShadow?.(entry);}})],server:{host:'127.0.0.1',port:0,strictPort:false}});
  try {
    await server.listen();
    const address=server.httpServer?.address();
    assert.ok(address&&typeof address==='object');
    const endpoint=`http://127.0.0.1:${address.port}/api/evaluate/sql`;
    const submit=async()=>fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({challengeId:'analyst-sql-retention',answer:'SELECT 1;'})});
    const completed=new Promise<Record<string,unknown>>(resolve=>{onShadow=resolve;});
    const first=await submit();
    const officialFirst=await first.json() as Evaluation;
    assert.equal(first.status,200);
    assert.equal(officialFirst.score,0);
    assert.equal(officialFirst.components?.essentialGateApplied,true);
    assert.equal((await completed).status,'complete');
    assert.equal(officialFirst.score,0,'shadow high score must not change official score');

    failShadow=true;
    const failedShadow=new Promise<Record<string,unknown>>(resolve=>{onShadow=resolve;});
    const second=await submit();
    const officialSecond=await second.json() as Evaluation;
    assert.equal(second.status,200,'Gemini failure must not fail SQL assessment');
    assert.equal(officialSecond.score,0);
    assert.equal((await failedShadow).status,'unavailable');
    assert.equal(events.length,2);
  } finally { await server.close(); }
}

console.log(JSON.stringify({suite:'Gemini local shadow evaluator',cases:11,passed:11}));
