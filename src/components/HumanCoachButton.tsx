/**
 * "Message a human coach" — the button and its message box, self-contained,
 * so every chat can show it (2026-11-24).
 *
 * The coach tells members to tap "the Message a human coach button here in
 * the chat". It existed on the main chat page only: in a chat opened from a
 * program day, a workout review or an Engine day there was nothing to tap.
 * tests/coachCards.test.ts fails if a chat screen has neither this button nor
 * the main chat's own.
 */
import { useEffect, useState } from 'react';
import { UserRound } from 'lucide-react';
import CoachContactModal from './CoachContactModal';
import { supabase } from '../lib/supabase';

export default function HumanCoachButton() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? ''), () => {});
  }, []);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          display: 'flex', alignItems: 'center', gap: 7, margin: '10px auto 0',
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 999,
          padding: '7px 16px', color: 'var(--text)', fontSize: 13, fontWeight: 600,
          cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        <UserRound size={15} /> Message a human coach
      </button>
      {open && <CoachContactModal userEmail={email} onClose={() => setOpen(false)} />}
    </>
  );
}
