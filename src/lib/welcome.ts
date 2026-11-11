import { supabase } from './supabase';

/** Per-session "already routed" flag the WelcomeGate checks before the DB. */
export const WELCOME_SEEN_KEY = (uid: string) => `welcome-done:${uid}`;

/** Mark the welcome intake as seen for this account: the per-session flag
 *  plus profiles.welcome_seen_at (best-effort — a failed write must never
 *  trap anyone; the gate also treats an existing evaluation as oriented). */
export async function markWelcomeSeen(uid: string): Promise<void> {
  try { sessionStorage.setItem(WELCOME_SEEN_KEY(uid), '1'); } catch { /* ignore */ }
  try {
    await supabase.from('profiles').update({ welcome_seen_at: new Date().toISOString() }).eq('id', uid);
  } catch { /* proceed regardless */ }
}
