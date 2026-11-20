import { useCallback, useEffect, useRef, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type { Challenge } from '../types.ts';
import { runSqlAssessment, type SqlWorkspaceRun } from '../lib/sqlClient.ts';
import { remainingSeconds, formatRemainingTime } from '../lib/assessmentTimer.ts';
import { clearSqlAssessmentDraft, createTimedSqlAssessmentDraft, formatSqlAssessmentAnswer, SQL_ASSESSMENT_DRAFT_KEY, writeSqlAssessmentDraft, type SqlAssessmentDraft, type SqlEditorTab } from '../lib/sqlAssessmentPersistence.ts';
import '../lib/monacoSetup.ts';
import './SqlAssessmentWorkspace.css';

const tabs: Array<{id:SqlEditorTab;label:string}>=[{id:'schema',label:'Schema'},{id:'sample',label:'Sample data'},{id:'query',label:'Business query'}];
const emptyRun:SqlWorkspaceRun={schemaOk:false,seedOk:false,queryOk:false,columns:[],rows:[],rowCount:0,truncated:false,errors:{}};
const preventCopy=(event:React.ClipboardEvent)=>event.preventDefault();

function readRawDraft():string|null {try{return localStorage.getItem(SQL_ASSESSMENT_DRAFT_KEY);}catch{return null;}}

export interface SqlAssessmentWorkspaceProps {
  challenge:Challenge;
  onCancel():void;
  onSubmit(answer:string,candidate:string):Promise<boolean>;
}

export function SqlAssessmentWorkspace({challenge,onCancel,onSubmit}:SqlAssessmentWorkspaceProps) {
  const [draft,setDraft]=useState<SqlAssessmentDraft>(()=>createTimedSqlAssessmentDraft(readRawDraft(),Date.now()));
  const [clockNow,setClockNow]=useState(()=>Date.now());
  const [running,setRunning]=useState(false);
  const [submitting,setSubmitting]=useState(false);
  const [hasSubmitted,setHasSubmitted]=useState(false);
  const [expired,setExpired]=useState(false);
  const [submitError,setSubmitError]=useState('');
  const [persistenceError,setPersistenceError]=useState('');
  const submitted=useRef(false);
  const inFlight=useRef(false);
  const expirationStarted=useRef(false);
  const editor=useRef<import('monaco-editor').editor.IStandaloneCodeEditor|null>(null);
  const remaining=remainingSeconds(draft.deadlineAt,clockNow);
  const latest=draft.runs.at(-1)?.result;
  const activeCode=draft[draft.activeTab==='schema'?'schema':draft.activeTab==='sample'?'seed':'query'];

  useEffect(()=>{
    const interval=window.setInterval(()=>setClockNow(Date.now()),1000);
    return()=>window.clearInterval(interval);
  },[]);
  useEffect(()=>{
    try{writeSqlAssessmentDraft(draft);}
    catch{window.setTimeout(()=>setPersistenceError('Browser storage is unavailable. Keep this tab open; your work may not survive a refresh.'),0);}
  },[draft]);

  const run=useCallback(async()=>{
    if(running||expired||submitted.current)return;
    setRunning(true);setSubmitError('');
    let result:SqlWorkspaceRun;
    try{result=await runSqlAssessment({schema:draft.schema,seed:draft.seed,query:draft.query},challenge.id);}
    catch(error){result={...emptyRun,errors:{runtime:error instanceof Error?error.message:'SQL execution is unavailable.'}};}
    setDraft(current=>({...current,runs:[...current.runs,{runAt:new Date().toISOString(),result}].slice(-10)}));
    setRunning(false);
  },[challenge.id,draft.query,draft.schema,draft.seed,expired,running]);
  const runRef=useRef(run);
  useEffect(()=>{runRef.current=run;},[run]);

  const onEditorMount:OnMount=(instance,monaco)=>{
    editor.current=instance;
    monaco.editor.setTheme('proofpilot-dark');
    instance.addCommand(monaco.KeyMod.CtrlCmd|monaco.KeyCode.Enter,()=>{void runRef.current();});
  };

  const submit=useCallback(async(automatic:boolean)=>{
    if(inFlight.current||submitted.current)return false;
    if(!automatic&&!window.confirm('Submit this assessment now? Your attempt will be evaluated and locked.'))return false;
    inFlight.current=true;setSubmitting(true);setSubmitError('');
    try{
      const ok=await onSubmit(formatSqlAssessmentAnswer(draft),draft.candidate.trim()||'Candidate');
      if(ok){submitted.current=true;setHasSubmitted(true);try{clearSqlAssessmentDraft();}catch{/* completed report is already saved by the application */}}
      else setSubmitError(automatic?'Automatic submission could not reach the evaluator. Your attempt is locked; use Retry submission when service is available.':'Submission did not complete. Your work remains saved; try again.');
      return ok;
    }catch(error){setSubmitError(error instanceof Error?error.message:'Submission failed. Your work remains saved; try again.');return false;}
    finally{inFlight.current=false;setSubmitting(false);}
  },[draft,onSubmit]);

  useEffect(()=>{
    if(remaining===0&&!expirationStarted.current&&!submitted.current){
      expirationStarted.current=true;setExpired(true);void submit(true);
    }
  },[remaining,submit]);

  const changeEditor=(value:string)=>setDraft(current=>({...current,[current.activeTab==='schema'?'schema':current.activeTab==='sample'?'seed':'query']:value}));
  const selectTab=(tab:SqlEditorTab)=>setDraft(current=>({...current,activeTab:tab}));
  const questionProtection={onCopy:preventCopy,onCut:preventCopy,onContextMenu:(event:React.MouseEvent)=>event.preventDefault()};

  return <main className="app-main wrap sql-assessment-page">
    <div className="sql-workspace-top"><button className="back-link" onClick={onCancel}>← All assessments</button><div className="guided-meta"><span>{challenge.role.toUpperCase()}</span><span>{challenge.difficulty.toUpperCase()}</span><span>SQL · SQLITE</span></div></div>
    <div className="sql-workspace-heading"><div className="eyebrow">PRACTICAL SQL ASSESSMENT</div><h1>{challenge.title}</h1><p className="page-lead">Build and run your own schema, sample data, and repeat-customer query. Run checks work independently from submission.</p></div>
    <div className="sql-workspace-layout">
      <aside className="sql-question-panel protected-question" {...questionProtection}>
        <div className="section-label">ASSESSMENT BRIEF</div>
        <h2>{challenge.title}</h2>
        <p>{challenge.scenario}</p>
        <div className="sql-question-section"><strong>Your tasks</strong><ol>{challenge.requirements.map(item=><li key={item}>{item}</li>)}</ol></div>
        <div className="sql-question-section"><strong>Deliverables</strong><ul>{challenge.deliverables.map(item=><li key={item}>{item}</li>)}</ul></div>
        <details className="sql-question-details"><summary>Constraints and context</summary><p>{challenge.context}</p></details>
        <label className="sql-candidate-label" htmlFor="sql-candidate">Name for your report</label>
        <input id="sql-candidate" className="text-input" maxLength={80} value={draft.candidate} onChange={event=>setDraft(current=>({...current,candidate:event.target.value.slice(0,80)}))} placeholder="e.g. Alex Morgan" disabled={expired||hasSubmitted}/>
        <div className={`sql-countdown ${remaining!==null&&remaining<=300?'urgent':''}`} role="timer" aria-live="off"><span>TIME REMAINING</span><strong>{formatRemainingTime(remaining)}</strong></div>
        {expired&&<p className="sql-expiration" role="status">Time expired. Editing is locked and the saved attempt is being submitted.</p>}
        {persistenceError&&<p className="sql-workspace-error" role="alert">{persistenceError}</p>}
      </aside>
      <section className="sql-workbench" aria-label="SQL coding workspace">
        <div className="sql-editor-panel">
          <div className="sql-editor-toolbar"><div className="sql-editor-tabs" role="tablist" aria-label="SQL sections">{tabs.map(tab=><button key={tab.id} id={`sql-tab-${tab.id}`} role="tab" aria-selected={draft.activeTab===tab.id} aria-controls="sql-monaco-editor" className={draft.activeTab===tab.id?'active':''} onClick={()=>selectTab(tab.id)}>{tab.label}</button>)}</div><div className="sql-editor-actions"><span className="sql-language-badge">SQL · SQLite</span><button className="button secondary" onClick={()=>editor.current?.trigger('keyboard','actions.find',null)} disabled={expired||hasSubmitted}>Find</button><button className="button primary" onClick={()=>void run()} disabled={running||submitting||expired||hasSubmitted}>{running?'Running…':'Run SQL'}</button></div></div>
          <div className="sql-code-editor" id="sql-monaco-editor" role="tabpanel" aria-labelledby={`sql-tab-${draft.activeTab}`}><Editor height="100%" language="sql" theme="proofpilot-dark" value={activeCode} onChange={value=>changeEditor(value??'')} onMount={onEditorMount} loading={<div className="guided-query-empty">Loading SQL editor…</div>} options={{accessibilitySupport:'on',ariaLabel:`SQL ${draft.activeTab} editor`,automaticLayout:true,bracketPairColorization:{enabled:true},contextmenu:true,folding:true,fontFamily:'var(--mono)',fontSize:13,lineNumbers:'on',minimap:{enabled:false},padding:{top:14,bottom:14},readOnly:!remaining||running||submitting||hasSubmitted,renderLineHighlight:'line',scrollBeyondLastLine:false,tabSize:2,wordWrap:'off'}}/></div>
          <p className="sql-editor-help">Tab indents · Ctrl/⌘+F finds text · Ctrl/⌘+Enter runs all three sections. Run does not submit your assessment.</p>
        </div>
        <section className="sql-execution-output" aria-live="polite"><div className="sql-output-header"><div><span className="section-label">EXECUTION OUTPUT</span><small>Fresh in-memory SQLite database for each run</small></div><span className={`sql-run-status ${latest?.queryOk?'success':''}`}>{latest?latest.queryOk?'Executed':'Errors':'Not run'}</span></div>
          {!latest?<div className="guided-query-empty">Run SQL to see genuine results from your schema and sample data.</div>:Object.keys(latest.errors).length>0?<div className="sql-errors" role="alert">{Object.entries(latest.errors).map(([stage,message])=><p key={stage}><strong>{stage.toUpperCase()}</strong><code>{message}</code></p>)}</div>:latest.queryOk?<><div className="guided-results-scroll"><table><thead><tr>{latest.columns.map((column,index)=><th key={`${column}-${index}`}>{column}</th>)}</tr></thead><tbody>{latest.rows.map((row,rowIndex)=><tr key={rowIndex}>{row.map((cell,cellIndex)=><td key={cellIndex}>{cell===null?'NULL':String(cell)}</td>)}</tr>)}</tbody></table></div><p className="guided-status">{latest.rowCount}{latest.truncated?'+':''} returned row{latest.rowCount===1?'':'s'}{latest.truncated?' · Output capped at 200 rows or 50 KB.':''}</p></>:<div className="guided-query-empty">The schema and sample data were set up, but no query was executed.</div>}
        </section>
        <section className="sql-reasoning-panel"><label htmlFor="sql-reasoning"><span className="section-label">REASONING &amp; EXPLANATION · OPTIONAL</span><small>Explain your approach, assumptions, and validation. This informs reasoning feedback but cannot replace executable SQL evidence.</small></label><textarea id="sql-reasoning" value={draft.reasoning} onChange={event=>setDraft(current=>({...current,reasoning:event.target.value.slice(0,10_000)}))} placeholder="Describe your data grain, why you count orders this way, and how you would validate the result…" disabled={expired||hasSubmitted}/></section>
        <div className="sql-submit-row"><div>{submitError&&<p className="sql-workspace-error" role="alert">{submitError}</p>}<small>Submission is evaluated once and saved to your browser-local assessment history.</small></div><button className="button primary sql-submit-button" onClick={()=>void submit(false)} disabled={submitting||hasSubmitted}>{submitting?'Submitting…':expired?'Retry submission':hasSubmitted?'Submitted':'Submit Assessment'}</button></div>
      </section>
    </div>
  </main>;
}
