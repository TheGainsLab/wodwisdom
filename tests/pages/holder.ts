import type { fakeSupabase } from './fakeSupabase';
/** The stand-in database the mocked `supabase` export points at right now. */
export const holder: { fake: ReturnType<typeof fakeSupabase> | null } = { fake: null };
