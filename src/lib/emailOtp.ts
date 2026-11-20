import type { Session, SupabaseClient } from '@supabase/supabase-js';

export type SupabaseAuthApi=SupabaseClient['auth'];
export type EmailOtpClient=Pick<SupabaseAuthApi,'signInWithOtp'|'verifyOtp'|'getSession'|'onAuthStateChange'|'signOut'>;

export function friendlyAuthError(error:unknown):string {
  const value=error&&typeof error==='object'?error as {message?:unknown;code?:unknown;name?:unknown}:{};
  const message=typeof value.message==='string'?value.message.toLowerCase():'';
  const code=typeof value.code==='string'?value.code.toLowerCase():'';
  const name=typeof value.name==='string'?value.name.toLowerCase():'';
  if(code==='otp_expired'||/otp.*expired|token.*expired/.test(message)) return 'That code has expired. Request a new code and try again.';
  if(/invalid.*(otp|token)|(otp|token).*(invalid|incorrect)|token has expired or is invalid/.test(message)) return 'That code is incorrect or expired. Check it, or request a new code.';
  if(code==='otp_disabled') return 'Email code sign-in is disabled for this Supabase project. Enable it in the Supabase Auth settings.';
  if(code.includes('rate_limit')||code.includes('email_send_rate_limit')||/too many requests|rate limit/.test(message)) return 'Too many code requests. Wait a few minutes, then try again.';
  if(name.includes('retryablefetch')||name.includes('network')||/failed to fetch|network error|timeout|timed out|load failed/.test(message)) return 'A network error interrupted sign-in. Check your connection and try again.';
  return 'Sign-in could not be completed. Check your email and code, then try again.';
}

function normalizedEmail(email:string):string {
  const value=email.trim();
  if(value.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error('Enter a valid email address.');
  return value;
}

export async function requestEmailOtp(auth:EmailOtpClient,email:string):Promise<void> {
  const address=normalizedEmail(email);
  try {
    const {error}=await auth.signInWithOtp({email:address,options:{shouldCreateUser:true}});
    if(error) throw error;
  } catch(error) { throw new Error(friendlyAuthError(error)); }
}

export async function verifyEmailOtp(auth:EmailOtpClient,email:string,code:string):Promise<void> {
  const address=normalizedEmail(email),token=code.trim();
  if(!/^\d{6,8}$/.test(token)) throw new Error('Enter the code from your email.');
  try {
    const {error}=await auth.verifyOtp({email:address,token,type:'email'});
    if(error) throw error;
  } catch(error) { throw new Error(friendlyAuthError(error)); }
}

export async function restoreAuthSession(auth:EmailOtpClient) {
  const {data,error}=await auth.getSession();
  if(error) throw error;
  return data.session;
}

export function subscribeAuthSession(auth:EmailOtpClient,onSession:(session:Session|null)=>void) {
  return auth.onAuthStateChange((_event,session)=>onSession(session)).data.subscription;
}

export async function signOutOfSupabase(auth:EmailOtpClient):Promise<void> {
  try { const {error}=await auth.signOut(); if(error) throw error; }
  catch(error) { throw new Error(friendlyAuthError(error)); }
}
