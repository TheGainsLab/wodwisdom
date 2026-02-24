import { createClient, FunctionsHttpError } from '@supabase/supabase-js';

export { FunctionsHttpError };

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://hsiqzmbfulmfxbvbsdwz.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhzaXF6bWJmdWxtZnhidmJzZHd6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5MTQ5NjYsImV4cCI6MjA4NjQ5MDk2Nn0.Il9Qgv06SoHhKaXNw5FESukqtb-7eQotp9XtDwZ_5uI';
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export const ANON_KEY = SUPABASE_ANON_KEY;

/** Returns fresh auth headers for fetch (e.g. streaming). Use supabase.functions.invoke() when possible. */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  return { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' };
}
export const CHAT_ENDPOINT = SUPABASE_URL + '/functions/v1/chat';
export const SUMMARIZE_ENDPOINT = SUPABASE_URL + '/functions/v1/summarize';
export const WORKOUT_REVIEW_ENDPOINT = SUPABASE_URL + '/functions/v1/workout-review';
export const PARSE_WORKOUT_ENDPOINT = SUPABASE_URL + '/functions/v1/parse-workout';
export const LOG_WORKOUT_ENDPOINT = SUPABASE_URL + '/functions/v1/log-workout';
export const PROFILE_ANALYSIS_ENDPOINT = SUPABASE_URL + '/functions/v1/profile-analysis';
export const CREATE_CHECKOUT_ENDPOINT = SUPABASE_URL + '/functions/v1/create-checkout';
export const CREATE_PORTAL_ENDPOINT = SUPABASE_URL + '/functions/v1/create-portal-session';
export const INVITE_ENDPOINT = SUPABASE_URL + '/functions/v1/invite-coach';
export const ADMIN_ENDPOINT = SUPABASE_URL + '/functions/v1/admin-data';
export const ANALYZE_PROGRAM_ENDPOINT = SUPABASE_URL + '/functions/v1/analyze-program';
export const INCORPORATE_ENDPOINT = SUPABASE_URL + '/functions/v1/incorporate-movements';
export const FINALIZE_MODIFICATION_ENDPOINT = SUPABASE_URL + '/functions/v1/finalize-modification';
export const SYNC_PROGRAM_BLOCKS_ENDPOINT = SUPABASE_URL + '/functions/v1/sync-program-blocks';
