import { useState, type FormEvent } from 'react';
import './AuthGate.css';

interface AuthGateProps {
  ready:boolean;
  configured:boolean;
  startupError:string;
  onRequestOtp(email:string):Promise<void>;
  onVerifyOtp(email:string,code:string):Promise<void>;
}

export function AuthGate({ready,configured,startupError,onRequestOtp,onVerifyOtp}:AuthGateProps) {
  const [step,setStep]=useState<'email'|'code'>('email');
  const [email,setEmail]=useState('');
  const [code,setCode]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');

  const requestCode=async(event?:FormEvent)=>{
    event?.preventDefault();
    setBusy(true);setError('');setNotice('');
    try {
      await onRequestOtp(email);
      setStep('code');setCode('');setNotice(`A sign-in code was sent to ${email.trim()}.`);
    } catch(cause) { setError(cause instanceof Error?cause.message:'Could not send a sign-in code. Try again.'); }
    finally { setBusy(false); }
  };
  const verifyCode=async(event:FormEvent)=>{
    event.preventDefault();
    setBusy(true);setError('');setNotice('');
    try { await onVerifyOtp(email,code); }
    catch(cause) { setError(cause instanceof Error?cause.message:'Could not verify the code. Try again.'); }
    finally { setBusy(false); }
  };

  return <div className="app-shell auth-shell">
    <header className="topbar auth-topbar"><div className="brand" aria-label="ProofPilot"><span className="brand-mark">P</span><span>proofpilot</span></div></header>
    <main className="auth-gate wrap">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="eyebrow"><span className="live-dot"/> SECURE EMAIL SIGN-IN</div>
        <h1 id="auth-title">{!ready?'Restoring your':step==='email'?'Welcome to':'Check your'}<br/><span className="gradient-text">{!ready?'session':step==='email'?'workspace':'email.'}</span></h1>
        {!ready ? <p className="page-lead">Checking for an existing ProofPilot session…</p> : !configured ? <>
          <p className="page-lead">Email sign-in is not configured for this local build yet.</p>
          <div className="auth-setup-note" role="status">Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> in your local environment, then restart Vite.</div>
        </> : step==='email' ? <>
          <p className="page-lead">Enter your email and we’ll send you a one-time sign-in code.</p>
          {startupError&&<p className="auth-error" role="alert">{startupError}</p>}
          <form className="auth-form" onSubmit={requestCode}>
            <label htmlFor="auth-email">Email address</label>
            <input id="auth-email" className="text-input" type="email" autoComplete="email" required maxLength={254} value={email} onChange={event=>setEmail(event.target.value)} placeholder="you@example.com" disabled={busy}/>
            {error&&<p className="auth-error" role="alert">{error}</p>}
            <button className="button primary full" type="submit" disabled={busy}>{busy?<><span className="spinner"/> Sending code…</>:'Send sign-in code'}</button>
          </form>
          <p className="auth-footnote">Passwordless sign-in. Your existing assessment data stays in this browser.</p>
        </> : <>
          <p className="page-lead">Enter the one-time code from the email sent to <strong>{email.trim()}</strong>.</p>
          {notice&&<p className="auth-notice" role="status">{notice}</p>}
          <form className="auth-form" onSubmit={verifyCode}>
            <label htmlFor="auth-code">Email code</label>
            <input id="auth-code" className="text-input auth-code-input" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,8}" minLength={6} maxLength={8} required value={code} onChange={event=>setCode(event.target.value.replace(/\D/g,'').slice(0,8))} placeholder="Enter your code" disabled={busy}/>
            {error&&<p className="auth-error" role="alert">{error}</p>}
            <button className="button primary full" type="submit" disabled={busy}>{busy?<><span className="spinner"/> Verifying…</>:'Verify and continue'}</button>
          </form>
          <div className="auth-secondary-actions"><button type="button" className="text-button" disabled={busy} onClick={()=>{setStep('email');setCode('');setError('');setNotice('');}}>Change email</button><button type="button" className="text-button" disabled={busy} onClick={()=>void requestCode()}>Send a new code</button></div>
        </>}
      </section>
    </main>
  </div>;
}
