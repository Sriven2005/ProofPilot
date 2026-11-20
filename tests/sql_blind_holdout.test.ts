import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { sqlBlindHoldout } from './benchmarks/sqlBlindHoldout.ts';
import { evaluateSqlBenchmark, type SqlExecutionResult } from '../src/lib/sqlEvaluation.ts';

const run=spawnSync('python',['src/server/sqlite_sandbox.py'],{encoding:'utf8',input:JSON.stringify(sqlBlindHoldout),timeout:20000,maxBuffer:2*1024*1024});
assert.equal(run.status,0,`blind holdout execution failed: ${run.stderr||run.stdout}`);
const execution=JSON.parse(run.stdout) as SqlExecutionResult[];
const scored=sqlBlindHoldout.map((item,index)=>({item,result:execution[index],evaluation:evaluateSqlBenchmark(item,execution[index])}));
const valid=scored.filter(x=>x.item.expectValid);
const invalid=scored.filter(x=>!x.item.expectValid);
const validMisses=valid.filter(x=>!x.result.controlledQueryOk||!x.result.controlledDataOk||x.evaluation.score<75);
const falseHigh=invalid.filter(x=>x.evaluation.score>=70);
assert.equal(validMisses.length,0,`valid holdout alternatives missed: ${validMisses.map(x=>`${x.item.id}=${x.evaluation.score}`).join(', ')}`);
assert.equal(falseHigh.length,0,`invalid holdout false positives: ${falseHigh.map(x=>`${x.item.id}=${x.evaluation.score}`).join(', ')}`);
console.log(JSON.stringify({total:scored.length,valid:valid.length,invalid:invalid.length,validMisses:validMisses.length,falseHigh:falseHigh.length,cases:scored.map(x=>({id:x.item.id,expectedValid:x.item.expectValid,score:x.evaluation.score,controlledDataOk:x.result.controlledDataOk,controlledQueryOk:x.result.controlledQueryOk,findings:x.result.controlledFindings}))},null,2));
