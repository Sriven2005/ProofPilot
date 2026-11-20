import { useState } from 'react';
import type { AssessmentRecord, GuidedAssessmentResult } from '../types';
import './DataAnalystAssessment.css';

export interface GuidedAssessmentReportProps {
  record: AssessmentRecord;
  mode: 'results' | 'report';
  onViewReport(): void;
  onBack(): void;
  onNewAssessment(): void;
}

export function GuidedAssessmentReport({ record, mode, onViewReport, onBack, onNewAssessment }: GuidedAssessmentReportProps) {
  const [copied, setCopied] = useState(false);
  const result = record.evaluation.guidedAssessment as GuidedAssessmentResult;
  const readiness = result.problemSolvingScore > result.implementationScore
    ? 'The written evidence shows stronger problem-solving than the executed SQL evidence. Use the SQL skill gaps below to plan focused practice before making a job-readiness judgment.'
    : result.implementationScore > result.problemSolvingScore
      ? 'The executed SQL evidence is stronger than the written interpretation and recommendations. Strengthen explanation, causal caution, and business communication before making a job-readiness judgment.'
      : 'Problem-solving and implementation scores are level for this submission. Review the per-skill evidence and gaps before making a job-readiness judgment.';
  const isReport = mode === 'report';
  return <main className="app-main wrap">
    <article className="guided-report">
      <div className="guided-report-toolbar no-print">
        <button className="back-link" onClick={onBack}>{isReport ? '← Back to results' : '← New assessment'}</button>
        <div>{isReport && <><button className="button secondary" onClick={() => { const url = `${window.location.origin}${window.location.pathname}#report=${encodeURIComponent(record.id)}`; void navigator.clipboard.writeText(url).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1800); }).catch(() => undefined); }}>{copied ? 'Copied report URL' : 'Copy report URL'}</button><button className="button secondary" onClick={() => window.print()}>Print report</button></>}{!isReport && <button className="button primary" onClick={onViewReport}>View detailed report →</button>}</div>
      </div>
      <div className="eyebrow">DATA ANALYST · APPLIED ASSESSMENT · {new Date(record.evaluation.completedAt).toLocaleDateString()}</div>
      <h1>{record.candidate}</h1>
      <p className="guided-report-lead">Investigated a three-month retail sales decline using a deterministic, synthetic dataset and browser-side SQLite. Report ID: {record.id}.</p>
      <div className="guided-score-pair">
        <section className="guided-score-box"><span>PROBLEM-SOLVING SCORE</span><strong>{result.problemSolvingScore}<small>/100</small></strong><p>Understanding, analysis, interpretation, evidence reasoning, and recommendations.</p></section>
        <section className="guided-score-box"><span>IMPLEMENTATION SCORE</span><strong>{result.implementationScore}<small>/100</small></strong><p>SQL execution, concepts, validated result groups, useful coverage, and query evidence.</p></section>
      </div>
      <section className="guided-report-section"><h2>Data Analyst readiness signal</h2><p>{readiness} This is a deterministic practice signal, not a hiring decision, professional certification, or independently verified assessment.</p></section>
      <section className="guided-report-section"><h2>Individual skill breakdown</h2>{result.skillBreakdown.map(skill => <div key={skill.skill}><div className="guided-skill-row"><span>{skill.skill}</span><div className="guided-skill-track"><i style={{ width: `${skill.score}%` }} /></div><small>{skill.score}</small></div><div className="guided-skill-feedback"><strong>Evidence:</strong> {skill.evidence.length ? skill.evidence.join(' ') : 'No specific evidence was verified.'}<br/><strong>Next:</strong> {skill.gaps.length ? skill.gaps.join(' ') : 'Continue applying this skill to new business questions.'}</div></div>)}</section>
      <section className="guided-report-section"><h2>Assessment responses</h2><p><strong>Investigation approach</strong><br/>{result.understanding || 'No response provided.'}</p><p><strong>Observations</strong><br/>{result.observations || 'No response provided.'}</p><p><strong>Interpretation</strong><br/>{result.interpretation || 'No response provided.'}</p><p><strong>Business recommendations</strong><br/>{result.recommendations || 'No response provided.'}</p>{result.reasoning && <p><strong>Additional reasoning</strong><br/>{result.reasoning}</p>}</section>
      <section className="guided-report-section"><h2>Executed queries and evidence</h2>{result.queryEvidence.length ? result.queryEvidence.map((query, index) => <div className="guided-report-query" key={`${query.runAt}-${index}`}><code>{query.sql}</code><span>{query.status === 'success' ? `${query.rowCount} actual rows returned${query.truncated ? ' (output truncated)' : ''}${query.assessmentTag && query.assessmentTag !== 'other' ? ` · ${query.assessmentTag} result ${query.expectedMatch ? 'matched' : 'did not match'} dataset validation` : ''}` : `Execution error: ${query.error ?? 'No result returned.'}`}</span>{query.status === 'success' && query.columns.length > 0 && <span>Columns: {query.columns.join(', ')} · Sample output: {JSON.stringify(query.rows.slice(0, 3)).slice(0, 500)}</span>}</div>) : <p>No SQL queries were run.</p>}</section>
      <section className="guided-report-section"><h2>Strengths</h2>{record.evaluation.strengths.length ? record.evaluation.strengths.map((item, index) => <p key={index}>• {item}</p>) : <p>No verified strengths were identified from the submitted evidence.</p>}</section>
      <section className="guided-report-section"><h2>Weaknesses and recommendations</h2>{record.evaluation.improvements.length ? record.evaluation.improvements.map((item, index) => <p key={index}>• {item}</p>) : <p>Keep validating analysis and recommendations against new datasets.</p>}</section>
      <p className="guided-report-disclosure">Both scores were generated by deterministic browser-side rules using the recorded responses and actual local SQLite query outputs. This two-score report is saved in this browser profile; it is not synced to the existing account database because that contract stores one overall score. No AI evaluator, independent reviewer, or trusted server scoring service was used. The report URL is available only in this browser profile; it is not a public hosted report.</p>
      {!isReport && <div className="result-actions no-print"><button className="button primary" onClick={onViewReport}>Open report</button><button className="button quiet" onClick={onNewAssessment}>Try another challenge</button></div>}
    </article>
  </main>;
}
