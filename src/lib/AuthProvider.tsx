import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { AuthContext } from './AuthContext';
import { friendlyAuthError, requestEmailOtp, restoreAuthSession, signOutOfSupabase, subscribeAuthSession, verifyEmailOtp } from './emailOtp';
import { supabase, supabaseConfigured } from './supabase';

const missingClient=()=>new Error('Supabase sign-in is not configured.');

export function AuthProvider({children}:{children:ReactNode}) {
  const [session,setSession]=useState<Session|null>(null);
  const [ready,setReady]=useState(!supabaseConfigured);
  const [startupError,setStartupError]=useState('');

  useEffect(()=>{
    const client=supabase;
    if(!client) return;
    let active=true,authEventReceived=false;
    const subscription=subscribeAuthSession(client.auth, nextSession=>{
      authEventReceived=true;
      if(active){setSession(nextSession);setReady(true);setStartupError('');}
    });
    void restoreAuthSession(client.auth).then(restored=>{
      if(active&&!authEventReceived){setSession(restored);setReady(true);}
    }).catch(error=>{
      if(active&&!authEventReceived){setSession(null);setStartupError(friendlyAuthError(error));setReady(true);}
    });
    return ()=>{active=false;subscription.unsubscribe();};
  },[]);

  const requestOtp=useCallback(async(email:string)=>{
    if(!supabase) throw missingClient();
    await requestEmailOtp(supabase.auth,email);
  },[]);
  const verifyOtp=useCallback(async(email:string,code:string)=>{
    if(!supabase) throw missingClient();
    await verifyEmailOtp(supabase.auth,email,code);
  },[]);
  const signOut=useCallback(async()=>{
    if(!supabase) throw missingClient();
    await signOutOfSupabase(supabase.auth);
  },[]);

  const value=useMemo(()=>({configured:supabaseConfigured,ready,session,startupError,requestOtp,verifyOtp,signOut}),[ready,session,startupError,requestOtp,verifyOtp,signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
