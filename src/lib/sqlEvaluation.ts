import type { CriterionScore, Evaluation } from '../types.ts';
import { getChallenge } from '../data/challenges.ts';
import { evaluateSubmission } from './evaluation.ts';

export interface SqlEvaluationInput { schema: string; seed: string; query: string; reasoning?: string; appCode?: string; }
export interface SqlExecutionResult {
  schemaOk: boolean; seedOk: boolean; queryOk: boolean; findings: string[]; rows: unknown[][]; columns?: string[];
  schema: Record<string, Array<{name:string;type:string;notNull:boolean;pk:boolean}> | unknown>;
  probes: Record<string, boolean>;
  controlledDataOk?: boolean; controlledQueryOk?: boolean; controlledRows?: unknown[][]; controlledColumns?: string[]; controlledFindings?: string[];
  sampleShape?: { customers:number; orders:number; repeatCustomers:number; zeroOrderCustomers:number };
}
const weights=[15,25,20,25,15] as const;
const names=['Problem understanding','Technical correctness','Reasoning and approach','Practical implementation','Measurement and validation'] as const;
const unique=(items:string[])=>[...new Set(items)];
type Column={name:string;type:string;notNull:boolean;pk:boolean};
const table=(result:SqlExecutionResult,name:string):Column[]=>Array.isArray(result.schema[name])?result.schema[name] as Column[]:[];
const check=(result:SqlExecutionResult,key:string)=>result.probes?.[key]===true;
const findColumn=(columns:Column[],aliases:string[])=>columns.find(column=>aliases.includes(column.name.toLowerCase()));
function matchesExpected(result:SqlExecutionResult):boolean {
  const rows=result.controlledRows ?? result.rows;
  const columns=(result.controlledColumns ?? result.columns ?? []).map(x=>x.toLowerCase());
  const index=(choices:string[],fallback:number)=>{const i=columns.findIndex(x=>choices.includes(x));return i<0?fallback:i;};
  if (!rows || rows.length!==2) return false;
  const ni=index(['customer_name','name','full_name','customer'],1),ci=index(['order_count','count','orders','distinct_orders'],2),si=index(['total_spend_cents','total_cents','spend_cents','total_amount_cents','amount_cents','total'],3);
  const actual=rows.map(row=>[String(row[ni]),Number(row[ci]),Number(row[si])] as [string,number,number]).sort((a,b)=>a[0].localeCompare(b[0]));
  return JSON.stringify(actual)===JSON.stringify([['Li',3,5500],['Mina',2,24550]]);
}
function criterion(name:typeof names[number],weight:number,score:number,evidence:string[],missing:string[],incorrect:string[]):CriterionScore {
  const note=`${score}/100. ${evidence.join(' ')||'No positive evidence was verified.'}${incorrect.length?` Incorrect: ${unique(incorrect).join(' ')}`:''}${missing.length?` Missing: ${unique(missing).join(' ')}`:''}`;
  return {name,weight,score,note,evidence,missing,incorrect:unique(incorrect)};
}

/**
 * Deterministic rubric: 65% of the weighted criteria are directly verified (technical 25,
 * implementation 25, validation 15); 35% assess the approach demonstrated by the executable
 * query (understanding 15, reasoning 20). Any essential schema/data/query failure gates the total
 * at 49, so prose or partial artifacts cannot produce a strong proficiency result.
 */
export function evaluateSqlBenchmark(item:SqlEvaluationInput,result:SqlExecutionResult,reasoningEvaluation?:Evaluation):Evaluation {
  const completedAt=new Date().toISOString();
  const customers=table(result,'customers'),orders=table(result,'orders');
  const cpk=customers.some(c=>c.pk),opk=orders.some(c=>c.pk);
  const fkRows=Array.isArray(result.schema.ordersFK)?result.schema.ordersFK as unknown[][]:[];
  const fk=fkRows.some(row=>String(row[0]).toLowerCase()==='customers');
  const customerName=findColumn(customers,['name','customer_name','full_name','customer']);
  const orderAmount=findColumn(orders,['total_cents','amount_cents','total_amount_cents','total_spend_cents','amount','total']);
  const foreignColumn=fkRows.find(row=>String(row[0]).toLowerCase()==='customers')?.[1];
  const foreignField=typeof foreignColumn==='string'?orders.find(c=>c.name.toLowerCase()===foreignColumn.toLowerCase()):undefined;
  const requiredFields=Boolean(customerName&&orderAmount&&foreignField);
  // Email uniqueness and an order date are sensible optional design choices, but
  // neither is required to solve the stated repeat-customer task.
  const nonNull=Boolean(customerName?.notNull&&orderAmount?.notNull&&foreignField?.notNull);
  const textAffinity=Boolean(customerName&&/(?:CHAR|CLOB|TEXT)/i.test(customerName.type));
  const integerAffinity=Boolean(orderAmount&&/INT/i.test(orderAmount.type));
  const typed=textAffinity&&integerAffinity;
  const correct=Boolean(result.controlledQueryOk ?? result.queryOk)&&matchesExpected(result);
  const hasTables=customers.length>0&&orders.length>0;
  const schemaValid=Boolean(result.schemaOk)&&hasTables;
  const fkIntegrity=fk&&check(result,'orphanOrderRejected');
  const oneToMany=Boolean(result.controlledDataOk) && !result.controlledFindings?.some(f=>/unique constraint failed.*customer/i.test(f));
  const requiredConstraints=nonNull;
  const shape=result.sampleShape;
  const sampleComplete=Boolean(result.seedOk)&&(!shape||(shape.customers>=3&&shape.orders>=3&&shape.repeatCustomers>=1&&shape.zeroOrderCustomers>=1));
  const appCode=item.appCode??'';
  const dangerousSql=Boolean(appCode)&&/\+\s*(?:userEmail|input|request|params?\.)/i.test(appCode)&&!/[?]|\$\d|:\w+/.test(appCode);
  const reasoningText=item.reasoning?.trim();
  const textEvaluation=reasoningEvaluation??(reasoningText?evaluateSubmission(reasoningText,getChallenge('analyst-sql-retention')):undefined);
  const understandingEvidence=textEvaluation?.criteria.find(c=>c.name==='Problem understanding');
  const approachEvidence=textEvaluation?.criteria.find(c=>c.name==='Reasoning and approach');
  const reasoningMistakes=textEvaluation?.criteria.filter(c=>c.name==='Problem understanding'||c.name==='Reasoning and approach').flatMap(c=>c.incorrect)??[];
  const mistakes=unique([
    ...result.findings,...(result.controlledFindings??[]),
    !cpk?'customers has no primary key.':'',!opk?'orders has no primary key.':'',!fk?'orders has no foreign key to customers.':'',
    fk&&!check(result,'orphanOrderRejected')?'An orphan order is accepted or foreign-key enforcement was not verified.':'',
    !oneToMany?'The schema does not support multiple orders for one customer or the controlled fixture could not load.':'',
    !requiredFields?'A customer name, foreign-key column, or integer-cent amount column is missing or unrecognized.':'',!nonNull?'Required customer name, order relationship, or amount fields accept NULL.':'',!typed?'Customer names must use a text type and order amounts must use integer cents.':'',
    !check(result,'negativeAmountRejected')?'Negative spend is accepted or its constraint was not verified.':'',
    !sampleComplete?'Candidate sample data is missing or lacks required customer/order edge cases.':'',!result.queryOk?'Submitted query has a syntax or execution error.':'',
    result.queryOk&&!correct?'Query runs but fails the controlled business result, cardinality, order count, or total.':'',dangerousSql?'Application example interpolates untrusted input; static detection only.':'',...reasoningMistakes
  ].filter(Boolean));
  if(!hasTables) {
    const absent='No relevant customers/orders schema was submitted; SQL keywords or unrelated SELECT results are not evidence for this challenge.';
    const criteria=names.map((name,i)=>criterion(name,weights[i],0,[],['Provide the required customer/order tables, relationship, sample data, and business query.'],[absent,...mistakes]));
    return {score:0,criteria,strengths:[],improvements:[absent,...mistakes],summary:'No relevant SQL implementation was submitted, so the result is zero.',completedAt,components:{deterministicVerification:0,technicalReasoning:0,essentialGateApplied:true}};
  }
  if (!item.schema.trim()&&!item.seed.trim()&&!item.query.trim()&&!item.appCode) {
    const criteria=names.map((n,i)=>criterion(n,weights[i],0,[],['No submission was provided.'],[]));
    return {score:0,criteria,strengths:[],improvements:['No response was submitted.'],summary:'Empty SQL submission; no evidence could be evaluated.',completedAt};
  }
  const technicalChecks=[cpk,opk,fk,fkIntegrity,requiredFields,nonNull,typed,check(result,'negativeAmountRejected')];
  let technicalScore=Math.round(technicalChecks.filter(Boolean).length/technicalChecks.length*100)-(dangerousSql?25:0);
  technicalScore=Math.max(0,technicalScore);
  const understandingScore=!hasTables?0:understandingEvidence?.score??(correct?100:result.queryOk?35:20);
  const reasoningScore=approachEvidence?.score??(!result.queryOk?0:correct?100:15);
  const practicalChecks=[schemaValid,sampleComplete,Boolean(result.queryOk),Boolean(result.controlledDataOk),Boolean(result.controlledQueryOk),correct];
  const practicalScore=Math.round(practicalChecks.filter(Boolean).length/practicalChecks.length*100)-(dangerousSql?15:0);
  const validationChecks=[check(result,'duplicateCustomerKeyRejected'),check(result,'orphanOrderRejected'),check(result,'negativeAmountRejected'),Boolean(result.controlledDataOk),correct];
  const validationScore=Math.round(validationChecks.filter(Boolean).length/validationChecks.length*100)-(dangerousSql?20:0);
  const essentialOk=schemaValid&&cpk&&opk&&fkIntegrity&&oneToMany&&requiredFields&&nonNull&&typed&&requiredConstraints&&sampleComplete&&result.queryOk&&result.controlledDataOk&&result.controlledQueryOk&&correct&&!dangerousSql;
  const raw=Math.round((understandingScore*15+technicalScore*25+reasoningScore*20+practicalScore*25+validationScore*15)/100);
  const completionGate=!requiredFields&&!sampleComplete&&!correct;
  const gateCeiling=completionGate?24:49;
  const essentialGateApplied=!essentialOk&&raw>gateCeiling;
  let scaled=essentialGateApplied?Math.floor(gateCeiling/raw*100):100;
  let finalValues=[understandingScore,technicalScore,reasoningScore,practicalScore,validationScore].map(value=>Math.floor(value*scaled/100));
  let score=Math.round(finalValues.reduce((sum,value,index)=>sum+value*weights[index],0)/100);
  while(essentialGateApplied&&score>gateCeiling){finalValues[1]=Math.max(0,finalValues[1]-1);score=Math.round(finalValues.reduce((sum,value,index)=>sum+value*weights[index],0)/100);}
  const missing=unique([
    !cpk?'Add a primary key to customers.':'', !opk?'Add a primary key to orders.':'',
    !fk?'Declare an orders-to-customers foreign key.':'', !fkIntegrity?'Reject an order whose customer does not exist.':'', !oneToMany?'Allow multiple orders for one customer.':'',
    !requiredFields?'Provide a customer name, customer relationship, and order amount in integer cents.':'', !nonNull?'Mark the customer name, relationship key, and amount as NOT NULL.':'', !typed?'Use a text type for names and integer cents for order amounts.':'',
    !sampleComplete?'Load representative sample rows, including a repeat customer and a customer with no orders.':'',
    !result.queryOk?'Fix the SQL syntax or execution error.':'', !correct?'Return one row per qualifying customer with the required distinct-order count and total spend.':''
  ].filter(Boolean));
  const schemaEvidence=item.schema.trim()?`Submitted DDL: ${item.schema.trim().slice(0,220)}`:'';
  const seedEvidence=item.seed.trim()?`Submitted sample data: ${item.seed.trim().slice(0,180)}`:'';
  const queryEvidence=item.query.trim()?`Submitted query: ${item.query.trim().slice(0,240)}`:'';
  const criteria=[
    criterion(names[0],15,finalValues[0],[hasTables?'Customer and order entities were detected.':'',...(understandingEvidence?.evidence??[]),schemaEvidence].filter(Boolean),[...(understandingEvidence?.missing??[]),...(!correct?'Demonstrate the customer-level repeat-customer definition in the query.':'')],mistakes),
    criterion(names[1],25,finalValues[1],[cpk?'Customer primary key is present.':'',opk?'Order primary key is present.':'',fk?'Foreign key metadata points to customers.':'',typed?'Core column types verified.':'',schemaEvidence].filter(Boolean),missing.filter(text=>/primary key|foreign key|customer does not exist|multiple orders|required customer and order columns|NOT NULL|appropriate SQLite types/.test(text)),mistakes),
    criterion(names[2],20,finalValues[2],[correct?'The submitted query produced the expected result on the verifier-owned edge dataset.':'',...(approachEvidence?.evidence??[]),queryEvidence].filter(Boolean),[...(approachEvidence?.missing??[]),...(!correct?'Use order identity, customer-level grain and the correct threshold/aggregation.':'')],mistakes),
    criterion(names[3],25,finalValues[3],[schemaValid?'DDL executed.':'',sampleComplete?'Candidate sample data loaded.':'',result.queryOk?'Submitted query executed.':'',correct?'Controlled output is correct.':'',seedEvidence,queryEvidence].filter(Boolean),missing.filter(text=>/representative sample|syntax|Return one row/.test(text)),mistakes),
    criterion(names[4],15,finalValues[4],[`${validationChecks.filter(Boolean).length} of ${validationChecks.length} constraint and hidden-result checks passed.`,queryEvidence].filter(Boolean),unique([
      !check(result,'duplicateCustomerKeyRejected')?'Reject duplicate customer or order keys.':'',
      !check(result,'orphanOrderRejected')?'Reject an order with no matching customer.':'',
      !check(result,'negativeAmountRejected')?'Reject negative order spend.':'',
      !result.controlledDataOk?'Load the verifier-controlled edge dataset.':'',
      !correct?'Pass the hidden expected-result query check.':''
    ].filter(Boolean)),mistakes)
  ];
  const deterministicVerification=Math.round((finalValues[1]*25+finalValues[3]*25+finalValues[4]*15)/65);
  const technicalReasoning=Math.round((finalValues[0]*15+finalValues[2]*20)/35);
  const recommendations=[...mistakes,...(essentialOk?[]:missing)];
  const strengths=unique(criteria.flatMap(c=>c.evidence.filter(e=>!e.startsWith('Submitted')))).slice(0,5);
  return {score,criteria,strengths,improvements:unique(recommendations),summary:essentialOk?`Deterministic SQL verification passed the essential checks (${score}/100).`:`An essential SQL requirement failed; the documented proficiency gate limits this result to ${gateCeiling}/100 (${score}/100).`,completedAt,components:{deterministicVerification,technicalReasoning,essentialGateApplied}};
}
