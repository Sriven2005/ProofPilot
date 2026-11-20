import assert from 'node:assert/strict';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { friendlyAuthError, requestEmailOtp, restoreAuthSession, signOutOfSupabase, subscribeAuthSession, verifyEmailOtp, type EmailOtpClient } from '../src/lib/emailOtp.ts';

const fakeSession={access_token:'not-a-real-token',refresh_token:'not-a-real-refresh-token',user:{id:'test-user',email:'test@example.com'}};
function authMock(overrides:Record<string,unknown>={}):EmailOtpClient {
  return {
    signInWithOtp:async()=>({error:null}),
    verifyOtp:async()=>({error:null}),
    getSession:async()=>({data:{session:null},error:null}),
    onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
    signOut:async()=>({error:null}),
    ...overrides
  } as unknown as EmailOtpClient;
}

{
  let sent:unknown;
  await requestEmailOtp(authMock({signInWithOtp:async(input:unknown)=>{sent=input;return {error:null};}}),'  candidate@example.com ');
  assert.deepEqual(sent,{email:'candidate@example.com',options:{shouldCreateUser:true}});
}

{
  let called=false;
  await assert.rejects(requestEmailOtp(authMock({signInWithOtp:async()=>{called=true;return {error:null};}}),'not-an-email'),/valid email/);
  assert.equal(called,false);
}

{
  let verified:unknown;
  await verifyEmailOtp(authMock({verifyOtp:async(input:unknown)=>{verified=input;return {error:null};}}),'candidate@example.com',' 123456 ');
  assert.deepEqual(verified,{email:'candidate@example.com',token:'123456',type:'email'});
  await assert.rejects(verifyEmailOtp(authMock(),'candidate@example.com','12x'),/Enter the code/);
}

{
  await assert.rejects(requestEmailOtp(authMock({signInWithOtp:async()=>({error:{code:'over_email_send_rate_limit'}})}),'candidate@example.com'),/Too many code requests/);
  await assert.rejects(verifyEmailOtp(authMock({verifyOtp:async()=>({error:{code:'otp_expired'}})}),'candidate@example.com','123456'),/expired/);
  await assert.rejects(verifyEmailOtp(authMock({verifyOtp:async()=>({error:{message:'Invalid token'}})}),'candidate@example.com','123456'),/incorrect or expired/);
  await assert.rejects(requestEmailOtp(authMock({signInWithOtp:async()=>{throw new TypeError('Failed to fetch');}}),'candidate@example.com'),/network error/);
  assert.match(friendlyAuthError({code:'otp_disabled'}),/disabled/);
}

{
  const session=await restoreAuthSession(authMock({getSession:async()=>({data:{session:fakeSession},error:null})}));
  assert.equal(session,fakeSession);
  await assert.rejects(restoreAuthSession(authMock({getSession:async()=>({data:{session:null},error:new Error('storage failed')})})),/storage failed/);
}

{
  let callback:((event:AuthChangeEvent,session:Session|null)=>void)|undefined;
  let unsubscribed=false;
  let observed:Session|null|undefined;
  const subscription=subscribeAuthSession(authMock({onAuthStateChange:(listener:(event:AuthChangeEvent,session:Session|null)=>void)=>{callback=listener;return {data:{subscription:{unsubscribe(){unsubscribed=true;}}}};}}),session=>{observed=session;});
  assert.equal(typeof callback,'function');
  assert.ok(subscription);
  callback?.('SIGNED_IN',fakeSession as Session);
  assert.equal(observed,fakeSession);
  subscription.unsubscribe();
  assert.equal(unsubscribed,true);
}

{
  await signOutOfSupabase(authMock());
  await assert.rejects(signOutOfSupabase(authMock({signOut:async()=>({error:{message:'Network error'}})})),/network error/);
}

console.log(JSON.stringify({suite:'Supabase email OTP helpers',cases:7,passed:7}));
