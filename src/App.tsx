import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { challenges, getChallenge } from './data/challenges';
import { assessmentDomains, createInitialSelection, getTopic, getTopicAssessments, isAssessmentAvailable, selectAssessment, selectDomain, selectTopic, type AssessmentDomainId } from './data/assessmentCatalog';
import { GuidedAssessmentReport } from './components/GuidedAssessmentReport';
import { SqlAssessmentWorkspace } from './components/SqlAssessmentWorkspace';
import { CriterionEvidencePanel } from './components/CriterionEvidencePanel';
import { RubricEvaluationProvider } from './lib/evaluation';
import { evaluateSqlAnswer } from './lib/sqlClient';
import { useAuth } from './lib/AuthContext';
import { retailSalesRows } from './data/retailSales';
import { appendAssessmentRecordPreservingUnknown, clearAssessmentDraft, inspectAssessmentStorage, readAssessmentDraft, readAssessmentRecords, writeAssessmentDraft } from './lib/persistence';
import { ensureUserProfile, getAssessmentHistory, importLocalAssessments, saveCompletedAssessment } from './lib/assessmentRepository';
import type { AssessmentRecord, ChallengeId, View } from './types';
import './App.css';
import './AssessmentCatalog.css';

const DataAnalystAssessment = lazy(() => import('./components/DataAnalystAssessment').then(module => ({ default: module.DataAnalystAssessment })));

const STORAGE_KEY = 'proofpilot.assessments.v1';
const evaluator = new RubricEvaluationProvider();
const makeId = () => `PP-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
const readLocalAssessmentSnapshot = () => {
  try { return inspectAssessmentStorage(localStorage.getItem(STORAGE_KEY)); }
  catch { return { records: readAssessmentRecords(), unsupportedCount: 0 }; }
};

function Mark({ kind, size = 18 }: { kind: string; size?: number }) {
  const paths: Record<string, string> = {
    arrow: 'M5 12h14M13 6l6 6-6 6', chevron: 'm9 18 6-6-6-6', sparkle: 'm12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Zm7 11 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z', check: 'm5 12 4 4L19 6', clock: 'M12 8v4l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z', chart: 'M3 3v18h18M8 15l4-4 4 3 5-7', shield: 'M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z', copy: 'M8 8V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-4M4 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2Z', back: 'm15 18-6-6 6-6M9 12h12', external: 'M14 3h7v7m-1-6-9 9M5 7H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-1', target: 'M12 2v4m0 12v4M2 12h4m12 0h4m-4.2-4.2a5.5 5.5 0 1 1-7.6 0 5.5 5.5 0 0 1 7.6 0Z'
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind] ?? paths.sparkle} /></svg>;
}

function GuidedHeader({ view, email, onNavigate, onSignOut }: { view: View; email?: string; onNavigate(view: View): void; onSignOut?: () => void }) {
  return <header className="topbar"><button className="brand" onClick={() => onNavigate('home')} aria-label="ProofPilot home"><span className="brand-mark"><Mark kind="target" size={19}/></span><span>proofpilot</span></button><nav className="topnav" aria-label="Main navigation"><button onClick={() => onNavigate('home')} className={view === 'home' ? 'nav-active' : ''}>Overview</button><button onClick={() => onNavigate('setup')} className={view === 'setup' || view === 'guided' || view === 'workspace' ? 'nav-active' : ''}>Assessments</button><button onClick={() => onNavigate('results')} className={view === 'results' ? 'nav-active' : ''}>My evidence</button></nav>{onSignOut && <button className="profile-chip" onClick={onSignOut} title="Sign out" aria-label={`Sign out${email ? ` ${email}` : ''}`}><span className="avatar">{email?.slice(0,1).toUpperCase() || 'P'}</span><span>Sign out</span><Mark kind="chevron" size={14}/></button>}</header>;
}

function App() {
  const auth = useAuth();
  const [draft] = useState(readAssessmentDraft);
  const [selection, setSelection] = useState(() => createInitialSelection(draft?.challengeId));
  const [initialLocal] = useState(readLocalAssessmentSnapshot);
  const [localRecords, setLocalRecords] = useState<AssessmentRecord[]>(initialLocal.records);
  const [unsupportedLocalCount] = useState(initialLocal.unsupportedCount);
  const [remoteState, setRemoteState] = useState<{ userId: string; records: AssessmentRecord[] } | null>(null);
  const [view, setView] = useState<View>(draft ? 'workspace' : 'home');
  const [challengeId, setChallengeId] = useState<ChallengeId>(draft?.challengeId ?? selection.challengeId ?? 'analyst-retail-sales-decline');
  const [candidate, setCandidate] = useState(draft?.candidate ?? '');
  const [answer, setAnswer] = useState(draft?.answer ?? '');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [authActionError, setAuthActionError] = useState('');
  const [syncMessage, setSyncMessage] = useState('');
  const [migrationBusy, setMigrationBusy] = useState(false);
  const records = useMemo(() => {
    const remoteRecords = remoteState?.userId === auth.session?.user.id ? (remoteState?.records ?? []) : [];
    const merged = new Map<string, AssessmentRecord>();
    for (const record of [...remoteRecords, ...localRecords]) merged.set(record.id, record);
    return [...merged.values()].sort((a, b) => Date.parse(b.evaluation.completedAt) - Date.parse(a.evaluation.completedAt));
  }, [auth.session?.user.id, localRecords, remoteState]);
  const challenge = useMemo(() => getChallenge(challengeId), [challengeId]);
  const topic = getTopic(selection.domainId, selection.topicId);
  const topicAssessments = getTopicAssessments(selection.domainId, selection.topicId);
  const selectedAssessment = selection.challengeId ? getChallenge(selection.challengeId) : null;
  const assessmentAvailable = isAssessmentAvailable(selection);
  const active = records.find((record) => record.id === activeId) ?? null;

  useEffect(() => {
    const user = auth.session?.user;
    if (!user) return;
    let current = true;
    void (async () => {
      try {
        await ensureUserProfile(user);
        const history = await getAssessmentHistory();
        if (current) { setRemoteState({ userId: user.id, records: history }); setSyncMessage(''); }
      } catch {
        if (current) setSyncMessage('Account history could not be refreshed. Your saved browser assessments are still available.');
      }
    })();
    return () => { current = false; };
  }, [auth.session?.user]);

  useEffect(() => {
    if (view === 'workspace') {
      try { writeAssessmentDraft({ challengeId, candidate, answer }); }
      catch { setError('This browser could not save your draft. Check available storage and try again.'); }
    } else if (view === 'results') {
      try { clearAssessmentDraft(); } catch { /* storage may be disabled */ }
    }
  }, [answer, candidate, challengeId, view]);
  useEffect(() => {
    const match = window.location.hash.match(/^#report=(.+)$/);
    if (match) {
      try {
        const id = decodeURIComponent(match[1]);
        const found = records.find((record) => record.id === id);
        if (found) { setActiveId(id); setChallengeId(found.challengeId); setView('report'); }
      } catch { window.history.replaceState(null, '', window.location.pathname + window.location.search); }
    }
  }, [records]);
  useEffect(() => {
    if (view === 'results' && !activeId && records.length) setActiveId(records[0].id);
  }, [activeId, records, view]);

  const navigate = (next: View) => {
    if (next === 'setup' && view !== 'setup' && records.length && selection.challengeId === records[0].challengeId) {
      const previousIndex = challenges.findIndex((item) => item.id === records[0].challengeId);
      const nextChallengeId = challenges[(previousIndex + 1) % challenges.length].id;
      setChallengeId(nextChallengeId);
      setSelection(createInitialSelection(nextChallengeId));
    }
    setError(''); setView(next);
    if (next !== 'report') { window.history.replaceState(null, '', window.location.pathname + window.location.search); }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const start = () => {
    setAnswer(''); setError('');
    if (challenge.id === 'analyst-retail-sales-decline') { navigate('guided'); return; }
    navigate('workspace');
  };
  const submit = async (answerOverride?: string, candidateOverride?: string): Promise<boolean> => {
    const submittedAnswer = (answerOverride ?? answer).trim();
    const submittedCandidate = (candidateOverride ?? candidate).trim() || 'Candidate';
    if (answerOverride === undefined && submittedAnswer.length > 0 && submittedAnswer.length < 40) { setError('Add a little more detail before submitting (at least 40 characters).'); return false; }
    setLoading(true); setError('');
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      const evaluation = challenge.id === 'analyst-sql-retention'
        ? await evaluateSqlAnswer(submittedAnswer, challenge.id)
        : await evaluator.evaluate(submittedAnswer, challenge);
      const record: AssessmentRecord = { id: makeId(), candidate: submittedCandidate, challengeId: challenge.id, answer: submittedAnswer, evaluation, scoreTrust: 'client_unverified' };
      const updatedLocalRecords = [record, ...localRecords];
      let storageError = '';
      try { localStorage.setItem(STORAGE_KEY, appendAssessmentRecordPreservingUnknown(localStorage.getItem(STORAGE_KEY), record)); }
      catch { storageError = 'This browser could not save your evidence. Check available storage and try again.'; }
      setLocalRecords(updatedLocalRecords); setActiveId(record.id); setLoading(false); navigate('results');
      if (auth.session) {
        try {
          await saveCompletedAssessment(record);
          setRemoteState((current) => ({ userId: auth.session!.user.id, records: [record, ...(current?.userId === auth.session!.user.id ? current.records.filter((item) => item.id !== record.id) : [])] }));
          setSyncMessage('');
        } catch {
          setSyncMessage('This assessment is saved in this browser. Account sync is unavailable, and the saved record can be retried later.');
        }
      } else {
        setSyncMessage('This assessment is saved in this browser profile. It is not uploaded or independently verified.');
      }
      if (storageError) { setError(storageError); setSyncMessage(storageError); }
      return true;
    } catch {
      setLoading(false); setError('We couldn’t evaluate this response. Please try submitting again.');
      return false;
    }
  };
  const importBrowserHistory = async () => {
    if (!localRecords.length || migrationBusy) return;
    const skipped = unsupportedLocalCount ? ` ${unsupportedLocalCount} unsupported or corrupted record${unsupportedLocalCount === 1 ? '' : 's'} cannot be safely imported and will remain in this browser.` : '';
    const approved = window.confirm(`Import ${localRecords.length} saved assessment${localRecords.length === 1 ? '' : 's'} to your private account? This includes your submitted responses and reports. Your browser records will remain unchanged.${skipped}`);
    if (!approved) return;
    setMigrationBusy(true); setSyncMessage('Importing saved browser assessments…');
    try {
      const { imported, alreadyPresent } = await importLocalAssessments(localRecords, true);
      const history = await getAssessmentHistory();
      setRemoteState({ userId: auth.session!.user.id, records: history });
      setSyncMessage(`${imported} browser assessment${imported === 1 ? '' : 's'} imported; ${alreadyPresent} already existed. Browser copies remain intact.`);
    } catch {
      setSyncMessage('Some browser assessments could not be imported. Existing browser records are unchanged; retrying is safe.');
    } finally { setMigrationBusy(false); }
  };
  const openReport = (record: AssessmentRecord) => { setActiveId(record.id); setChallengeId(record.challengeId); navigate('report'); window.history.replaceState(null, '', `#report=${encodeURIComponent(record.id)}`); };
  const copyReport = async () => {
    if (!active) return;
    const url = `${window.location.origin}${window.location.pathname}#report=${encodeURIComponent(active.id)}`;
    try { await navigator.clipboard.writeText(url); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
    catch { setError('Clipboard access is unavailable. You can copy the report URL from your address bar.'); }
  };
  const reset = () => {
    const previousIndex = challenges.findIndex((item) => item.id === records[0]?.challengeId);
    const nextChallengeId = challenges[(previousIndex + 1 + challenges.length) % challenges.length].id;
    setActiveId(null); setAnswer(''); setCandidate('');
    setChallengeId(nextChallengeId);
    setSelection(createInitialSelection(nextChallengeId));
    navigate('setup');
  };

  const chooseDomain = (domainId: AssessmentDomainId) => {
    const next = selectDomain(domainId);
    setSelection(next);
    if (next.challengeId) setChallengeId(next.challengeId);
  };
  const chooseTopic = (topicId: string) => {
    const next = selectTopic(selection, topicId);
    setSelection(next);
    if (next.challengeId) setChallengeId(next.challengeId);
  };
  const chooseAssessment = (id: string) => {
    const candidate = topicAssessments.find(item => item.id === id);
    if (!candidate) return;
    const next = selectAssessment(selection, candidate.id);
    setSelection(next);
    setChallengeId(candidate.id);
  };

  const completeGuidedAssessment = (evaluation: import('./types').Evaluation, candidateName: string) => {
    const id = makeId();
    const details = evaluation.guidedAssessment;
    const reportText = details ? [details.understanding, details.observations, details.interpretation, details.recommendations, details.reasoning].filter(Boolean).join('\n\n') : '';
    const record: AssessmentRecord = { id, candidate: candidateName, challengeId: 'analyst-retail-sales-decline', answer: reportText, evaluation, scoreTrust: 'client_unverified' };
    setLoading(true);
    try {
      localStorage.setItem(STORAGE_KEY, appendAssessmentRecordPreservingUnknown(localStorage.getItem(STORAGE_KEY), record));
      setLocalRecords(current => [record, ...current.filter(item => item.id !== id)]);
    } catch {
      setLocalRecords(current => [record, ...current.filter(item => item.id !== id)]);
      setSyncMessage('The report is available in this session, but browser storage could not save it.');
    }
    setActiveId(id);
    setChallengeId(record.challengeId);
    setLoading(false);
    navigate('results');
  };

  const signOut = () => { setAuthActionError(''); void auth.signOut().catch((cause: unknown) => setAuthActionError(cause instanceof Error ? cause.message : 'Sign-out failed. Try again.')); };
  const optionalSignOut = auth.session ? signOut : undefined;
  if (view === 'guided') return <div className="app-shell"><GuidedHeader view={view} email={auth.session?.user.email} onNavigate={navigate} onSignOut={optionalSignOut}/><Suspense fallback={<main className="app-main wrap guided-assessment"><div className="guided-query-empty" role="status">Loading the assessment workspace…</div></main>}><DataAnalystAssessment onCancel={() => navigate('setup')} onComplete={(evaluation, name) => void completeGuidedAssessment(evaluation, name)}/></Suspense>{authActionError && <div className="toast-region"><div className="toast auth-logout-error" role="alert">{authActionError}</div></div>}</div>;
  if ((view === 'results' || view === 'report') && active?.evaluation.guidedAssessment) return <div className="app-shell"><GuidedHeader view={view} email={auth.session?.user.email} onNavigate={navigate} onSignOut={optionalSignOut}/>{syncMessage && <p className="error-message wrap" role="status">{syncMessage}</p>}<GuidedAssessmentReport record={active} mode={view} onViewReport={() => openReport(active)} onBack={() => navigate(view === 'report' ? 'results' : 'setup')} onNewAssessment={reset}/>{authActionError && <div className="toast-region"><div className="toast auth-logout-error" role="alert">{authActionError}</div></div>}</div>;

  return <div className="app-shell">
    <header className="topbar no-print">
      <button className="brand" onClick={() => navigate('home')} aria-label="ProofPilot home"><span className="brand-mark"><Mark kind="target" size={19} /></span><span>proofpilot</span></button>
      <nav className="topnav" aria-label="Main navigation">
        <button onClick={() => navigate('home')} className={view === 'home' ? 'nav-active' : ''}>Overview</button>
        <button onClick={() => navigate('setup')} className={view === 'setup' || view === 'workspace' ? 'nav-active' : ''}>Assessments</button>
        <button onClick={() => navigate('results')} className={view === 'results' ? 'nav-active' : ''}>My evidence</button>
      </nav>
      {auth.session && <button className="profile-chip" onClick={() => { setAuthActionError(''); void auth.signOut().catch((cause:unknown) => setAuthActionError(cause instanceof Error ? cause.message : 'Sign-out failed. Try again.')); }} title="Sign out" aria-label={`Sign out${auth.session.user.email ? ` ${auth.session.user.email}` : ''}`}><span className="avatar">{auth.session.user.email?.slice(0,1).toUpperCase() || 'P'}</span><span>Sign out</span><Mark kind="chevron" size={14} /></button>}
    </header>

    {view === 'home' && <main className="home-page">
      <section className="hero wrap">
        <div className="hero-copy"><div className="eyebrow"><span className="live-dot" /> SKILL PROOF, BUILT FOR REAL WORK</div>
          <h1>Prove what<br />you <span className="gradient-text">know.</span></h1>
          <p className="hero-description">Resumes tell your story. Practical challenges show your skills in action. Build credible evidence that gives your next opportunity a reason to say yes.</p>
          <div className="hero-actions"><button className="button primary" onClick={() => navigate('setup')}>Start an assessment <Mark kind="arrow" size={17} /></button><button className="button quiet" onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}>Explore how it works <Mark kind="chevron" size={16} /></button></div>
          <div className="social-proof"><div className="avatar-stack"><span>JD</span><span>AK</span><span>ML</span></div><p><strong>Show your work.</strong> Let the evidence speak.</p></div>
        </div>
        <div className="hero-visual" aria-label="Assessment evidence preview"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="glow-core"><span><Mark kind="target" size={32}/></span></div><div className="float-card card-score"><div className="mini-label">SKILL SIGNAL</div><div className="score-line"><strong>84</strong><span>/ 100</span><div className="score-ring">✓</div></div><div className="score-bar"><i/></div><small>Strong practical evidence</small></div><div className="float-card card-verified"><span className="verified-icon"><Mark kind="check" size={15}/></span><div><strong>Evidence verified</strong><small>Data analysis · 4 skills</small></div></div><div className="hero-caption">A clearer signal of what you can do.</div></div>
        <div className="hero-bottom"><span>BUILT AROUND REAL-WORLD WORK</span><div><span>Analytics</span><span>Engineering</span><span>AI &amp; ML</span><span>Product design</span></div></div>
      </section>
      <section className="how-section wrap" id="how-it-works"><div className="section-heading"><div className="eyebrow">FROM SKILL TO SIGNAL</div><h2>Make your ability<br />easy to <span className="gradient-text">see.</span></h2><p>A short, practical challenge turns what you know into a useful, shareable record of how you think and work.</p></div>
        <div className="steps-grid"><article className="step-card"><div className="step-number">01 <Mark kind="target" size={18}/></div><h3>Choose a role</h3><p>Pick a realistic challenge built around the work you want to do.</p><span className="step-decoration role-pills">ANALYST <b>·</b> DESIGNER</span></article><article className="step-card"><div className="step-number">02 <Mark kind="chart" size={18}/></div><h3>Show your thinking</h3><p>Work through the scenario and explain your decisions in your own words.</p><span className="step-decoration typing-lines"><i/><i/><i/></span></article><article className="step-card"><div className="step-number">03 <Mark kind="shield" size={18}/></div><h3>Share your proof</h3><p>Get transparent feedback against a clear rubric, ready to share with a recruiter.</p><span className="step-decoration proof-stamp"><Mark kind="check" size={14}/> REPORT READY</span></article></div>
      </section>
      <section className="bottom-cta wrap"><div><div className="eyebrow">YOUR NEXT STEP STARTS HERE</div><h2>Let your skills<br/>speak for themselves.</h2></div><button className="button primary" onClick={() => navigate('setup')}>Choose your challenge <Mark kind="arrow" size={17}/></button><span className="cta-orb"/></section>
      <footer className="footer wrap"><button className="brand" onClick={() => navigate('home')}><span className="brand-mark"><Mark kind="target" size={17}/></span><span>proofpilot</span></button><span>Your skills. Your proof.</span><span>© 2025 ProofPilot</span></footer>
    </main>}

    {view === 'setup' && <main className="app-main wrap"><div className="page-top"><button className="back-link" onClick={() => navigate('home')}><Mark kind="back" size={16}/> Back to overview</button><div className="eyebrow">ASSESSMENT SETUP</div><h1>Choose your next<br/><span className="gradient-text">challenge.</span></h1><p className="page-lead">Choose a domain, narrow to a topic, then select an assessment that is currently available.</p></div>
      <div className="assessment-catalog"><section className="catalog-selection"><div className="catalog-section"><div className="section-label">01 <span>CHOOSE A DOMAIN</span></div><div className="catalog-domains" role="group" aria-label="Assessment domains">{assessmentDomains.map(domain => <button key={domain.id} className={`catalog-domain ${selection.domainId === domain.id ? 'selected' : ''}`} aria-pressed={selection.domainId === domain.id} onClick={() => chooseDomain(domain.id)}><strong>{domain.title}</strong><small>{domain.description}</small></button>)}</div></div><div className="catalog-section"><div className="section-label">02 <span>CHOOSE A TOPIC</span></div><div className="catalog-topics" role="group" aria-label={`${assessmentDomains.find(domain => domain.id === selection.domainId)?.title ?? 'Assessment'} topics`}>{assessmentDomains.find(domain => domain.id === selection.domainId)?.topics.map(item => <button key={item.id} className={`catalog-topic ${selection.topicId === item.id ? 'selected' : ''}`} aria-pressed={selection.topicId === item.id} onClick={() => chooseTopic(item.id)}><span>{item.title}</span><small>{getTopicAssessments(selection.domainId, item.id).length ? `${getTopicAssessments(selection.domainId, item.id).length} available` : 'Coming later'}</small></button>)}</div></div><div className="catalog-section"><label className="section-label" htmlFor="assessment-select">03 <span>SELECT AN ASSESSMENT</span></label>{topicAssessments.length ? <select id="assessment-select" className="catalog-assessment-select" value={selection.challengeId ?? ''} onChange={event => chooseAssessment(event.target.value)} aria-label="Available assessments">{topicAssessments.slice(0, 4).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select> : <div className="catalog-unavailable" role="status">{topic.unavailableMessage ?? 'No assessment is available in this topic yet.'}</div>}</div><div className="setup-note"><Mark kind="shield" size={17}/><span>Your progress is saved privately on this device.</span></div></section>
       <section className="challenge-preview" aria-live="polite">{selectedAssessment && assessmentAvailable ? <><div className="preview-top"><span className="challenge-tag"><span className="live-dot"/>{selectedAssessment.category}</span><span className="difficulty">{selectedAssessment.difficulty}</span></div><div className="challenge-symbol"><Mark kind={selectedAssessment.roleId === 'designer' ? 'sparkle' : selectedAssessment.roleId === 'ml' ? 'chart' : selectedAssessment.roleId === 'developer' ? 'chevron' : 'target'} size={24}/></div><h2>{selectedAssessment.title}</h2><p>{selectedAssessment.summary}</p>{selectedAssessment.id === 'analyst-retail-sales-decline' && <div className="guided-entry"><strong>Data Analyst role assessment</strong><p>Investigate a realistic business question using SQL, data analysis, statistical interpretation, problem-solving, and business communication.</p><small>Complete a guided investigation, run queries against {retailSalesRows.length} synthetic order lines, interpret evidence, and recommend a measurable next step.</small></div>}<div className="challenge-meta"><span><Mark kind="clock" size={15}/>{selectedAssessment.duration}</span><span><Mark kind="target" size={15}/>{selectedAssessment.skills.length} core skills</span></div><div className="preview-divider"/><div className="section-label">WHAT YOU'LL PRACTICE</div><div className="skill-tags">{selectedAssessment.skills.map((skill) => <span key={skill}>{skill}</span>)}</div><button className="button primary full" onClick={start}>Start this challenge <Mark kind="arrow" size={17}/></button><small className="preview-footnote">No sign-up required · About {selectedAssessment.duration}</small></> : <><div className="preview-top"><span className="challenge-tag">{assessmentDomains.find(domain => domain.id === selection.domainId)?.title}</span><span className="difficulty">Not available</span></div><h2>{topic.title}</h2><p>{topic.description}</p><div className="catalog-unavailable" role="status">{topic.unavailableMessage ?? 'An assessment for this topic is not available yet.'}</div><button className="button primary full" disabled>Assessment unavailable</button><small className="preview-footnote">Choose another topic to see implemented assessments.</small></>}</section></div>
      <div className="recent-row"><div><strong>Already completed an assessment?</strong><span>Your saved evidence is ready when you are.</span></div><button className="text-button" onClick={() => navigate('results')}>View my evidence <Mark kind="arrow" size={15}/></button></div>
    </main>}

  {view === 'workspace' && (challenge.id === 'analyst-sql-retention' ? <SqlAssessmentWorkspace challenge={challenge} onCancel={() => navigate('setup')} onSubmit={(submittedAnswer, submittedCandidate) => submit(submittedAnswer, submittedCandidate)}/> : <main className="app-main wrap workspace-page"><div className="workspace-top"><button className="back-link" onClick={() => navigate('setup')}><Mark kind="back" size={16}/> All challenges</button><div className="progress-caption"><span>CHALLENGE PROGRESS</span><strong>01 <i>/ 01</i></strong></div><div className="progress-track"><i/></div></div><div className="workspace-grid"><article className="workspace-content"><div className="eyebrow">{challenge.category.toUpperCase()} <span className="dot-separator">·</span> {challenge.difficulty.toUpperCase()}</div><h1>{challenge.title}</h1><p className="page-lead">{challenge.summary}</p><div className="scenario-box"><div className="section-label"><span className="scenario-mark"><Mark kind="sparkle" size={14}/></span> THE SCENARIO</div><p>{challenge.scenario}</p><div className="context-note"><strong>Available context</strong><p>{challenge.context}</p></div></div><div className="requirements"><div className="section-label">YOUR TASK <span className="task-count">3 PARTS</span></div>{challenge.requirements.map((item, i) => <div className="requirement" key={item}><span>{String(i + 1).padStart(2, '0')}</span><p>{item}</p></div>)}</div></article><aside className="answer-panel"><div className="answer-panel-top"><span className="panel-label">YOUR RESPONSE</span><span className="time-pill"><Mark kind="clock" size={14}/>{challenge.duration}</span></div><label htmlFor="candidate-name">Name for your evidence report</label><input id="candidate-name" className="text-input" value={candidate} onChange={(e) => setCandidate(e.target.value)} placeholder="e.g. Alex Morgan" maxLength={80}/><label htmlFor="answer">Walk us through your approach</label><textarea id="answer" value={answer} onChange={(e) => setAnswer(e.target.value)} onChangeCapture={() => setError('')} placeholder="Explain how you would approach this challenge. Share your reasoning, the decisions you would make, and how you would know they worked…"/><div className="answer-hint"><Mark kind="sparkle" size={14}/> Be specific. Your reasoning matters as much as your answer.</div><div className="character-count">{answer.trim().split(/\s+/).filter(Boolean).length} words <span>·</span> Saved as you write</div>{error && <p className="error-message" role="alert">{error}</p>}<button className="button primary full" onClick={() => void submit()} disabled={loading}>{loading ? <><span className="spinner"/> Evaluating your response…</> : <>Submit for feedback <Mark kind="arrow" size={17}/></>}</button><p className="evaluation-disclosure">Transparent rubric-based feedback. No AI service is used.</p></aside></div></main>)}

    {view === 'results' && <main className="app-main wrap results-page">{syncMessage && <p className="error-message" role="status" aria-live="polite">{syncMessage}</p>}{unsupportedLocalCount > 0 && <p className="error-message" role="status">{unsupportedLocalCount} unsupported or corrupted browser record{unsupportedLocalCount === 1 ? '' : 's'} could not be safely read or imported. The stored data has been left unchanged.</p>}{active ? <><div className="result-header"><button className="back-link" onClick={() => navigate('setup')}><Mark kind="back" size={16}/> New challenge</button><span className="status-chip"><Mark kind="check" size={13}/> COMPLETED</span></div><div className="result-title"><div className="eyebrow">ASSESSMENT COMPLETE <span className="dot-separator">·</span> {new Date(active.evaluation.completedAt).toLocaleDateString()}</div><h1>Here’s your <span className="gradient-text">skill signal.</span></h1><p className="page-lead">A transparent look at how you approached the {getChallenge(active.challengeId).role} challenge.</p></div><div className="results-grid"><section className="score-card"><div className="score-card-top"><div><div className="section-label">OVERALL SCORE</div><h2>{active.evaluation.score}<span>/100</span></h2></div><div className="large-score-ring" style={{ '--score': `${active.evaluation.score * 3.6}deg` } as React.CSSProperties}><span>{active.evaluation.score >= 80 ? 'Strong' : active.evaluation.score >= 65 ? 'Promising' : 'Developing'}</span></div></div><div className="score-meter"><i style={{ width: `${active.evaluation.score}%` }}/></div><p>{active.evaluation.summary}</p><div className="score-footer"><span><Mark kind="shield" size={14}/> RUBRIC-BASED EVALUATION</span><span>{active.id}</span></div></section><section className="criteria-card"><div className="section-label">SKILL BREAKDOWN</div>{active.evaluation.criteria.map((criterion) => <div className="criterion" key={criterion.name}><div className="criterion-line"><span>{criterion.name}</span><strong>{criterion.score}<small>/100</small></strong></div><div className="criterion-meter"><i style={{ width: `${criterion.score}%` }}/></div></div>)}</section><CriterionEvidencePanel criteria={active.evaluation.criteria}/><section className="feedback-card strengths"><div className="feedback-heading"><span><Mark kind="check" size={15}/></span><h3>What went well</h3></div>{active.evaluation.strengths.map((item) => <p key={item}>{item}</p>)}</section><section className="feedback-card improvements"><div className="feedback-heading"><span>↗</span><h3>Room to grow</h3></div>{active.evaluation.improvements.map((item) => <p key={item}>{item}</p>)}</section></div><div className="result-actions"><button className="button primary" onClick={() => openReport(active)}>View shareable report <Mark kind="arrow" size={17}/></button><button className="button secondary" onClick={() => window.print()}>Print results</button><button className="button quiet" onClick={reset}>Try another challenge</button>{auth.session && localRecords.length > 0 && <button className="button quiet" onClick={() => void importBrowserHistory()} disabled={migrationBusy}>{migrationBusy ? 'Importing…' : 'Import saved browser assessments'}</button>}</div><div className="transparency-note"><Mark kind="sparkle" size={16}/><p><strong>How this score works.</strong> ProofPilot uses a consistent, transparent rubric to look for signals in a written response. This is automated rubric feedback, not an AI assessment or a substitute for human review.</p></div></> : <><div className="empty-state"><div className="empty-icon"><Mark kind="chart" size={28}/></div><div className="eyebrow">YOUR EVIDENCE LIBRARY</div><h1>Proof, in progress.</h1><p className="page-lead">Complete a practical challenge to see your skill evidence and shareable report here.</p><button className="button primary" onClick={() => navigate('setup')}>Choose a challenge <Mark kind="arrow" size={17}/></button></div><div className="saved-empty"><Mark kind="shield" size={18}/><p><strong>Private by default</strong><span>Your completed assessments stay in this browser until you choose to share them.</span></p></div></>}</main>}

    {view === 'report' && <main className="report-wrap wrap">{active ? <><div className="report-toolbar no-print"><button className="back-link" onClick={() => navigate('results')}><Mark kind="back" size={16}/> Back to results</button><div><button className="button secondary" onClick={copyReport}><Mark kind="copy" size={15}/>{copied ? 'Copied report URL' : 'Copy report URL'}</button><button className="button primary" onClick={() => window.print()}>Print report <Mark kind="external" size={15}/></button></div></div><article className="report-sheet"><div className="report-brand"><span className="brand"><span className="brand-mark"><Mark kind="target" size={17}/></span><span>proofpilot</span></span><span className="report-stamp"><Mark kind="shield" size={14}/> SKILL EVIDENCE REPORT</span></div><div className="report-intro"><div className="eyebrow">PRACTICAL SKILL ASSESSMENT</div><h1>{active.candidate}</h1><p>{getChallenge(active.challengeId).role} <span>·</span> Completed {new Date(active.evaluation.completedAt).toLocaleDateString()}</p></div><div className="report-score-row"><div><span className="section-label">OVERALL SCORE</span><div className="report-score">{active.evaluation.score}<small>/100</small></div><span className="report-rating">{active.evaluation.score >= 80 ? 'Strong performance' : active.evaluation.score >= 65 ? 'Promising performance' : 'Developing performance'}</span></div><div className="report-challenge"><span className="section-label">CHALLENGE COMPLETED</span><strong>{getChallenge(active.challengeId).title}</strong><span>{getChallenge(active.challengeId).duration} <i>·</i> {getChallenge(active.challengeId).difficulty}</span></div><div className="report-id"><span className="section-label">REPORT ID</span><strong>{active.id}</strong><span>Completed and saved locally</span></div></div><div className="report-summary"><div className="section-label">ASSESSMENT SUMMARY</div><p>{active.evaluation.summary}</p><p className="report-method">{active.scoreTrust === 'server_verified' ? 'This result has been verified by the trusted assessment service.' : 'This deterministic rubric score was submitted by the browser and is marked client-unverified. It has not been independently verified by a trusted server evaluator; consider it alongside human review.'}</p></div><div className="report-breakdown"><div className="section-label">SKILL BREAKDOWN</div>{active.evaluation.criteria.map((item) => <div className="report-criterion" key={item.name}><span>{item.name}</span><div className="criterion-meter"><i style={{ width: `${item.score}%` }}/></div><strong>{item.score}</strong></div>)}</div><CriterionEvidencePanel criteria={active.evaluation.criteria}/><div className="report-feedback"><div><div className="section-label">STRENGTHS</div>{active.evaluation.strengths.map((x) => <p key={x}>{x}</p>)}</div><div><div className="section-label">NEXT TO DEVELOP</div>{active.evaluation.improvements.map((x) => <p key={x}>{x}</p>)}</div></div><div className="report-footer"><span>Your skills. Your proof.</span><span>ProofPilot · {active.id}</span></div></article><p className="report-share-hint no-print">Anyone with the report URL can open this report on this browser profile. Reports are stored locally and are not hosted publicly.</p></> : <div className="empty-state"><div className="eyebrow">REPORT NOT FOUND</div><h1>This report isn’t available here.</h1><p className="page-lead">Reports are saved in the browser where the assessment was completed.</p><button className="button primary" onClick={() => navigate('results')}>Go to my evidence <Mark kind="arrow" size={17}/></button></div>}</main>}
    <div className="toast-region" aria-live="polite">{authActionError&&<div className="toast auth-logout-error" role="alert">{authActionError}</div>}{copied && <div className="toast"><Mark kind="check" size={15}/> Report URL copied</div>}</div>
  </div>;
}

export default App;
