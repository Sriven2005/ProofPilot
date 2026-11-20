import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { sqlHoldoutCases } from './benchmarks/sqlHoldout.ts';
import { evaluateSqlBenchmark, type SqlExecutionResult } from '../src/lib/sqlEvaluation.ts';

const run=spawnSync('python',['src/server/sqlite_sandbox.py'],{encoding:'utf8',input:JSON.stringify(sqlHoldoutCases),timeout:20000,maxBuffer:2*1024*1024});
assert.equal(run.status,0,`holdout executor failed: ${run.stderr||run.stdout}`);
const result=JSON.parse(run.stdout) as SqlExecutionResult[];
assert.equal(result.length,sqlHoldoutCases.length);
const scored=sqlHoldoutCases.map((item,i)=>({item,result:result[i],score:evaluateSqlBenchmark(item,result[i]).score}));
const valid=scored.filter(x=>x.item.expectValid), invalid=scored.filter(x=>!x.item.expectValid);
const validMisses=valid.filter(x=>!x.result.controlledQueryOk||!x.result.controlledDataOk||x.score<75);
const falseHigh=invalid.filter(x=>x.score>=70);
assert.equal(validMisses.length,0,`valid holdouts penalized: ${validMisses.map(x=>x.item.id+':'+x.score).join(', ')}`);
assert.equal(falseHigh.length,0,`invalid holdouts scored highly: ${falseHigh.map(x=>x.item.id+':'+x.score).join(', ')}`);
assert.equal(scored.find(x=>x.item.id==='hold-10')?.score,0);
console.log(JSON.stringify({total:scored.length,valid:valid.length,invalid:invalid.length,validMisses:validMisses.length,falseHigh: falseHigh.length,cases:scored.map(x=>({id:x.item.id,expectedValid:x.item.expectValid,score:x.score,controlledDataOk:x.result.controlledDataOk,controlledQueryOk:x.result.controlledQueryOk,findings:x.result.controlledFindings}))},null,2));
