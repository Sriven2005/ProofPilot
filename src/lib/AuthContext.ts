import { createContext, useContext } from 'react';
import type { Session } from '@supabase/supabase-js';

export interface AuthContextValue {
  configured:boolean;
  ready:boolean;
  session:Session|null;
  startupError:string;
  requestOtp(email:string):Promise<void>;
  verifyOtp(email:string,code:string):Promise<void>;
  signOut():Promise<void>;
}

export const AuthContext=createContext<AuthContextValue|null>(null);

export function useAuth():AuthContextValue {
  const value=useContext(AuthContext);
  if(!value) throw new Error('useAuth must be used within AuthProvider.');
  return value;
}
