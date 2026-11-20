import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import '../lib/monacoSetup';
import type { Evaluation } from '../types';
import { RETAIL_DATA_DICTIONARY, RETAIL_DATASET_SCHEMA, RETAIL_SQL_GUIDE, retailSalesCsv } from '../data/retailSales';
import { evaluateDataAnalystAssessment, hasRetailDatasetExploration, hasVerifiedPerformanceBreakdown } from '../lib/dataAnalystEvaluation';
import { RetailSqlSession } from '../lib/retailSql';
import { clearGuidedAssessmentDraft, readGuidedAssessmentDraft, writeGuidedAssessmentDraft, type GuidedAssessmentDraft } from '../lib/guidedAssessmentPersistence';
import { formatRemainingTime, GUIDED_ASSESSMENT_DURATION_MS, remainingSeconds, startOrResumeTimebox } from '../lib/assessmentTimer';
import './DataAnalystAssessment.css';

const labels = ['Understand the data', 'Explore the data', 'Investigate performance', 'Interpret results', 'Business recommendations', 'Review and submit'];

export interface DataAnalystAssessmentProps {
  onCancel(): void;
  onComplete(evaluation: Evaluation, candidate: string): void;
}

export function DataAnalystAssessment({ onCancel, onComplete }: DataAnalystAssessmentProps) {
  const [draft, setDraft] = useState<GuidedAssessmentDraft>(() => startOrResumeTimebox(readGuidedAssessmentDraft(), Date.now(), GUIDED_ASSESSMENT_DURATION_MS));
  const [step, setStep] = useState(() => draft.currentStep);
  const [rowCount, setRowCount] = useState(0);
  const [engineError, setEngineError] = useState('');
  const [engineReady, setEngineReady] = useState(false);
  const [running, setRunning] = useState(false);
  const session = useRef<RetailSqlSession | null>(null);
  const editor = useRef<import('monaco-editor').editor.IStandaloneCodeEditor | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const submittedOnce = useRef(false);
  const runQueryRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const latest = draft.queries.at(-1) ?? null;
  const successfulCount = useMemo(() => draft.queries.filter(query => query.status === 'success').length, [draft.queries]);
  const secondsRemaining = remainingSeconds(draft.deadlineAt, clockNow) ?? 0;
  const expired = secondsRemaining === 0;

  useEffect(() => { const timer = window.setInterval(() => setClockNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);

  useEffect(() => {
    const worker = new RetailSqlSession();
    session.current = worker;
    worker.ready.then(count => { if (session.current === worker) { setRowCount(count); setEngineReady(true); } }).catch(error => { if (session.current === worker) setEngineError(error instanceof Error ? error.message : 'SQLite WebAssembly could not initialize.'); });
    return () => { worker.close(); if (session.current === worker) session.current = null; };
  }, []);

  useEffect(() => {
    if (submitted) return;
    try { writeGuidedAssessmentDraft(draft); } catch { window.setTimeout(() => setEngineError('Browser storage is unavailable; your current work may not survive a refresh.'), 0); }
  }, [draft, submitted]);

  const update = (key: keyof Omit<GuidedAssessmentDraft, 'queries'>, value: string) => { if (expired || submitted) return; setDraft(current => ({ ...current, [key]: value })); };
  const goToStep = (next: number) => {
    const bounded = Math.max(0, Math.min(labels.length - 1, next));
    if (expired || submitted) return;
    setStep(bounded);
    setDraft(current => ({ ...current, currentStep: bounded }));
  };
  const runQuery = useCallback(async () => {
    if (!session.current || running || expired || submitted) return;
    setRunning(true); setEngineError('');
    try {
      const result = await session.current.run(draft.query);
      setDraft(current => ({ ...current, queries: [...current.queries, result].slice(-10) }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'SQL execution failed.';
      setEngineError(message);
      setDraft(current => ({ ...current, queries: [...current.queries, { sql: current.query, status: 'error' as const, columns: [], rows: [], rowCount: 0, error: message, runAt: new Date().toISOString() }].slice(-10) }));
      if (message.includes('time limit') || message.includes('stopped')) {
        session.current?.close();
        const replacement = new RetailSqlSession();
        session.current = replacement;
        replacement.ready.then(count => { if (session.current === replacement) setRowCount(count); }).catch(error => { if (session.current === replacement) setEngineError(error instanceof Error ? error.message : 'SQLite WebAssembly could not restart.'); });
      }
    } finally { setRunning(false); }
  }, [draft.query, expired, running, submitted]);
  useEffect(() => { runQueryRef.current = runQuery; }, [runQuery]);
  const finish = useCallback((automatic = false) => {
    if (submittedOnce.current) return;
    if (!automatic && !window.confirm('Submit this assessment now? Your saved work will be evaluated and this attempt will be locked.')) return;
    submittedOnce.current = true;
    const evaluation = evaluateDataAnalystAssessment(draft);
    setSubmitted(true);
    try { clearGuidedAssessmentDraft(); } catch { /* keep completed record in normal assessment history */ }
    onComplete(evaluation, draft.candidate.trim() || 'Candidate');
  }, [draft, onComplete]);
  useEffect(() => { if (expired && !submittedOnce.current) finish(true); }, [expired, finish]);
  const stepComplete = (index: number) => {
    if (index === 0) return Boolean(draft.understanding.trim());
    if (index === 1) return hasRetailDatasetExploration(draft.queries);
    if (index === 2) return hasVerifiedPerformanceBreakdown(draft.queries);
    if (index === 3) return Boolean(draft.interpretation.trim());
    if (index === 4) return Boolean(draft.recommendations.trim());
    return false;
  };
  const reviewComplete = labels.slice(0, 5).every((_, index) => stepComplete(index));
  const downloadCsv = () => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([retailSalesCsv()], { type: 'text/csv;charset=utf-8' }));
    link.download = 'proofpilot-retail-sales.csv';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };
  const selectStarter = (sql: string) => update('query', sql);
  const onEditorMount: OnMount = (instance, monaco) => {
    editor.current = instance;
    monaco.editor.setTheme('proofpilot-dark');
    if (!monaco.languages.getLanguages().some((language: { id: string }) => language.id === 'sql')) {
      monaco.languages.register({ id: 'sql' });
      monaco.languages.setLanguageConfiguration('sql', { comments: { lineComment: '--', blockComment: ['/*', '*/'] }, brackets: [['(', ')'], ['[', ']']], autoClosingPairs: [{ open: '(', close: ')' }, { open: "'", close: "'" }, { open: '"', close: '"' }] });
      monaco.languages.setMonarchTokensProvider('sql', {
        ignoreCase: true,
        keywords: ['select', 'from', 'where', 'group', 'by', 'order', 'having', 'join', 'left', 'right', 'inner', 'outer', 'on', 'as', 'and', 'or', 'not', 'null', 'is', 'in', 'exists', 'case', 'when', 'then', 'else', 'end', 'limit', 'distinct', 'with', 'union', 'all', 'asc', 'desc'],
        tokenizer: {
          root: [[/--.*$/, 'comment'], [/\/\*/, 'comment', '@comment'], [/'([^']|'')*'/, 'string'], [/"([^"]|"")*"/, 'string'], [/[0-9]+(\.[0-9]+)?/, 'number'], [/[a-zA-Z_][\w$]*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }], [/[=<>!]+/, 'operator'], [/[;,.]/, 'delimiter'] ],
          comment: [[/[^*/]+/, 'comment'], [/\*\//, 'comment', '@pop'], [/[/*]/, 'comment']],
        },
      });
    }
    monaco.languages.registerCompletionItemProvider('sql', {
      provideCompletionItems: (model: import('monaco-editor').editor.ITextModel, position: import('monaco-editor').Position) => {
        const word = model.getWordUntilPosition(position);
        const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
        const keywords = ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'JOIN', 'LEFT JOIN', 'ON', 'AS', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'ROUND', 'DISTINCT', 'LIMIT'];
        const keywordSuggestions = keywords.map(label => ({ label, kind: monaco.languages.CompletionItemKind.Keyword, insertText: label, range }));
        const schemaSuggestions = ['retail_sales', 'order_id', 'order_date', 'product_id', 'product_name', 'category', 'region', 'quantity', 'unit_price', 'discount', 'revenue'].map(label => ({ label, kind: monaco.languages.CompletionItemKind.Field, insertText: label, range, detail: 'Supplied retail_sales schema' }));
        return { suggestions: [...keywordSuggestions, ...schemaSuggestions] };
      },
    });
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => { void runQueryRef.current(); });
  };
  const queryWorkspace = <div className="guided-sql-workspace">
    <div className="guided-sql-head"><div><span className="panel-label">SQL WORKSPACE</span><small>{engineReady ? `${rowCount} order lines loaded in local SQLite` : 'Loading the supplied dataset…'}</small></div><div className="guided-editor-controls"><button className="button secondary" disabled={!engineReady || running || expired} onClick={() => editor.current?.trigger('keyboard', 'actions.find', null)}>Find</button><button className="button secondary" disabled={!engineReady || running || expired} onClick={() => void runQuery()}>{running ? 'Running…' : 'Run query'}</button></div></div>
    <div className="guided-starters">{RETAIL_SQL_GUIDE.map(example => <button key={example.title} onClick={() => selectStarter(example.sql)}>{example.title}</button>)}</div>
    <label className="guided-sr-only" htmlFor="retail-sql-editor">SQL query editor</label>
    <div className="guided-monaco-editor" id="retail-sql-editor"><Editor height="100%" language="sql" theme="proofpilot-dark" value={draft.query} onChange={value => update('query', value ?? '')} onMount={onEditorMount} loading={<div className="guided-query-empty">Loading SQL editor…</div>} options={{ accessibilitySupport: 'on', ariaLabel: 'SQL query editor', automaticLayout: true, bracketPairColorization: { enabled: true }, codeLens: false, contextmenu: true, folding: true, fontFamily: 'var(--mono)', fontSize: 12, formatOnPaste: false, formatOnType: false, lineNumbers: 'on', minimap: { enabled: false }, padding: { top: 12, bottom: 12 }, readOnly: !engineReady || running || expired || submitted, renderLineHighlight: 'line', scrollBeyondLastLine: false, suggestOnTriggerCharacters: true, tabSize: 2, wordWrap: 'off' }} /></div>
    <p className="guided-sr-only" id="retail-sql-help">Read-only SQL runs against the supplied retail dataset. Tab indents, Ctrl or Command plus Enter runs the query. Suggestions are limited to SQL keywords and the supplied schema.</p>
    {engineError && <p className="error-message" role="alert">{engineError}</p>}
    {!engineError && !engineReady && <p className="guided-status" role="status">Starting SQLite WebAssembly…</p>}
    {latest && <div className="guided-query-output"><div className="guided-output-title"><strong>{latest.status === 'success' ? 'Query results' : 'SQL error'}</strong><span>{latest.status === 'success' ? `${latest.rowCount}${latest.truncated ? '+' : ''} rows` : 'No result was generated'}</span></div>
      {latest.status === 'error' ? <pre className="guided-sql-error">{latest.error}</pre> : <>
        <div className="guided-results-scroll"><table><thead><tr>{latest.columns.map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{latest.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell === null ? 'NULL' : String(cell)}</td>)}</tr>)}</tbody></table></div>
        {latest.truncated && <p className="guided-status">Output capped at 200 rows. Add filters to inspect a smaller result.</p>}
      </>}
    </div>}
    {!latest && <div className="guided-query-empty">Run a query to see rows returned from the actual supplied dataset.</div>}
    {draft.queries.length > 0 && <details className="guided-query-history"><summary>Query history ({draft.queries.length})</summary>{draft.queries.slice().reverse().map((item, index) => <button key={`${item.runAt}-${index}`} onClick={() => update('query', item.sql)}><span>{item.status === 'success' ? '✓' : '×'} {item.sql.split('\n')[0].slice(0, 78)}</span><small>{item.status === 'success' ? `${item.rowCount} rows` : 'Error'}</small></button>)}</details>}
  </div>;

  return <main className="app-main wrap guided-assessment">
    <div className="guided-top"><button className="back-link" onClick={onCancel}>← All assessments</button><div className="guided-meta"><span>DATA ANALYST</span><span>APPLIED</span><span>{formatRemainingTime(secondsRemaining)}</span><span>{draft.queries.length} QUERY RUNS</span></div></div>
    <div className="guided-title"><div className="eyebrow">PRACTICAL SKILL ASSESSMENT</div><h1>Investigate declining <span className="gradient-text">retail sales.</span></h1><p className="page-lead">Work through the evidence as a Junior Data Analyst. Your reasoning and SQL implementation are evaluated independently.</p></div>
    <div className="guided-progress" aria-label={`Step ${step + 1} of 6`}><div className="guided-step-list">{labels.map((label, index) => <button className={`${step === index ? 'active' : ''} ${stepComplete(index) ? 'complete' : ''}`} key={label} onClick={() => goToStep(index)}><span>{stepComplete(index) ? '✓' : String(index + 1).padStart(2, '0')}</span>{label}</button>)}</div><div className="guided-progress-track"><i style={{ width: `${((step + 1) / labels.length) * 100}%` }} /></div></div>

    {step === 0 && <section className="guided-split"><article className="guided-instructions"><div className="section-label">STEP 1 · UNDERSTAND THE DATA</div><h2>Your business question</h2><p>A retail company has experienced declining sales over the last three months. Investigate the order data, identify patterns, explain possible causes, and recommend a measurable response.</p><div className="guided-info-card"><strong>Dataset at a glance</strong><p>Six months of synthetic order-line sales across three regions and four product categories. Revenue is net of the recorded line discount.</p><button className="text-button" onClick={downloadCsv}>Download the supplied CSV ↓</button></div><h3>Schema</h3><pre className="guided-schema">{RETAIL_DATASET_SCHEMA}</pre><h3>Data dictionary</h3><div className="guided-dictionary">{RETAIL_DATA_DICTIONARY.map(([field, description]) => <p key={field}><code>{field}</code><span>{description}</span></p>)}</div><div className="guided-info-card"><strong>SQL reference</strong>{RETAIL_SQL_GUIDE.map(item => <details key={item.title}><summary>{item.title}</summary><code>{item.sql}</code></details>)}</div></article><aside className="guided-response"><label htmlFor="guided-candidate">Name for your report</label><input id="guided-candidate" className="text-input" maxLength={80} value={draft.candidate} onChange={event => update('candidate', event.target.value)} placeholder="e.g. Alex Morgan"/><label htmlFor="guided-understanding">Which fields and comparisons would help answer the sales question? What would you check first?</label><textarea id="guided-understanding" value={draft.understanding} onChange={event => update('understanding', event.target.value)} placeholder="Describe the relevant measures, time period, and a fair comparison…"/><p className="guided-status">Dataset generation is deterministic and synthetic. The downloadable CSV is the same data loaded into SQLite.</p></aside></section>}

    {(step === 1 || step === 2) && <section className="guided-split guided-explore"><article className="guided-instructions"><div className="section-label">STEP {step + 1} · {step === 1 ? 'EXPLORE THE DATA' : 'INVESTIGATE SALES PERFORMANCE'}</div><h2>{step === 1 ? 'Explore before concluding.' : 'Compare the key cuts.'}</h2><p>{step === 1 ? 'Inspect rows, check date coverage, distributions and data quality. Use repeated queries to refine your understanding.' : 'Investigate monthly revenue, then compare category and regional performance. Query output is not pre-filled; the table below shows the results of your SQL.'}</p><div className="guided-info-card"><strong>Investigation prompts</strong><ul><li>What is the monthly revenue trend and comparison baseline?</li><li>Which categories and regions change most?</li><li>Do revenue, units, and discount move together?</li><li>Which missing data could change your explanation?</li></ul></div><label htmlFor="guided-observations">What observations are you recording from your query outputs?</label><textarea id="guided-observations" value={draft.observations} onChange={event => update('observations', event.target.value)} placeholder="Record observations and note which query output supports each one…"/><p className="guided-status">No output is generated on failure. Results are capped at 200 rows, 30 columns, 500 characters per cell and 50 KB; the latest 10 queries are retained.</p></article><aside>{queryWorkspace}</aside></section>}

    {step === 3 && <section className="guided-writing"><div className="section-label">STEP 4 · INTERPRET RESULTS</div><h2>Separate what you observed from what you suspect.</h2><p className="page-lead">Explain patterns using the results you ran. Data here is observational; without cost, promotion or customer context, causes remain hypotheses.</p><label htmlFor="guided-interpretation">What do the results indicate? Which patterns are supported, and what assumptions or limitations remain?</label><textarea id="guided-interpretation" value={draft.interpretation} onChange={event => update('interpretation', event.target.value)} placeholder="Summarize the trend, quantify it, distinguish evidence from possible explanations, and note uncertainty…"/><div className="guided-result-evidence"><strong>Executed query evidence ({draft.queries.length})</strong>{draft.queries.length ? draft.queries.slice(-5).map((query, index) => <div key={`${query.runAt}-${index}`}><span>{query.status === 'success' ? '✓' : '×'} {query.status === 'success' ? `${query.rowCount} rows returned` : query.error}</span><code>{query.sql.slice(0, 180)}</code></div>) : <p>No query has been run yet. Return to a prior step to execute SQL.</p>}</div></section>}

    {step === 4 && <section className="guided-writing"><div className="section-label">STEP 5 · BUSINESS RECOMMENDATIONS</div><h2>Recommend a next action the business can test.</h2><p className="page-lead">Prioritize an action, connect it to your findings, name a success measure, and include a guardrail. Label assumptions clearly.</p><label htmlFor="guided-recommendations">What should the retail team do next, and how will you measure whether it worked?</label><textarea value={draft.recommendations} onChange={event => update('recommendations', event.target.value)} id="guided-recommendations" placeholder="State the action, supporting evidence, a success metric, an evaluation window, and a guardrail…"/><div className="guided-info-card"><strong>Recommendation checklist</strong><ul><li>Link the action to an observed trend or segment.</li><li>Distinguish a hypothesis from a verified cause.</li><li>Define a measurable success metric and comparison.</li><li>Include a margin, customer, or operational guardrail.</li></ul></div></section>}

    {step === 5 && <section className="guided-review"><div className="section-label">STEP 6 · REVIEW AND SUBMIT</div><h2>{reviewComplete ? 'Your work is ready for evaluation.' : 'Review your evidence before submitting.'}</h2><p className="page-lead">{reviewComplete ? 'You can return to any earlier step to edit your work. Problem-solving and SQL implementation receive independent scores.' : 'Some assessment steps are incomplete. You can submit now, but missing evidence will not receive credit.'}</p><div className="guided-review-grid"><div><strong>Investigation approach</strong><p>{draft.understanding || 'Not provided yet'}</p></div><div><strong>Query activity</strong><p>{successfulCount} successful executions · {draft.queries.length - successfulCount} errors · {draft.queries.length} total runs</p></div><div><strong>Observations</strong><p>{draft.observations || 'Not provided yet'}</p></div><div><strong>Interpretation</strong><p>{draft.interpretation || 'Not provided yet'}</p></div><div><strong>Recommendation</strong><p>{draft.recommendations || 'Not provided yet'}</p></div></div><p className="guided-unverified">Scores use deterministic rules and executed browser-side SQLite results. They are not AI-generated or independently verified.</p><button className="button primary" disabled={expired || submitted} onClick={() => finish(false)}>Submit assessment</button></section>}

    <div className="guided-controls"><button className="button secondary" disabled={step === 0 || expired || submitted} onClick={() => goToStep(step - 1)}>Previous step</button><span>STEP {step + 1} OF {labels.length}{stepComplete(step) ? ' · COMPLETE' : ''}</span>{step < labels.length - 1 && <button className="button primary" disabled={expired || submitted} onClick={() => goToStep(step + 1)}>Next step →</button>}<button className="button primary" disabled={submitted || expired} onClick={() => finish(false)}>{expired ? 'Submitting…' : submitted ? 'Submitted' : 'Submit Assessment'}</button></div>
  </main>;
}
