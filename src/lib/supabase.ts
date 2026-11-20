import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const projectUrl=import.meta.env.VITE_SUPABASE_URL?.trim();
const publishableKey=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

export const supabaseConfigured=Boolean(projectUrl&&publishableKey);
export const supabaseConfigurationError=!projectUrl
  ? 'Add VITE_SUPABASE_URL to your local environment to enable sign-in.'
  : !publishableKey
    ? 'Add VITE_SUPABASE_PUBLISHABLE_KEY to your local environment to enable sign-in.'
    : '';

/** Browser client uses only the Supabase publishable key; never use a service-role key here. */
export const supabase:SupabaseClient<Database>|null=supabaseConfigured
  ? createClient(projectUrl!,publishableKey!,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}})
  : null;
