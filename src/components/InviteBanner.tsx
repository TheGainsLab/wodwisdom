import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface Invite { id: string; gym_name: string; }

export default function InviteBanner({ session }: { session: Session }) {
  const [invite, setInvite] = useState<Invite | null>(null);
  const [name, setName] = useState('');

  useEffect(() => {
    const email = session.user.email;
    if (!email) return;
    supabase.from('gym_members').select('id, gym_id, gyms(name)').eq('invited_email', email.toLowerCase()).eq('status', 'invited').limit(1)
      .then(({ data }) => {
        if (data && data.length > 0) {
          const row = data[0] as any;
          setInvite({ id: row.id, gym_name: row.gyms?.name || 'A gym' });
        }
      });
  }, []);

  const respond = async (accept: boolean) => {
    if (!invite) return;
    if (accept) {
      if (!name.trim()) return;
      await supabase.from('gym_members').update({ user_id: session.user.id, status: 'active' }).eq('id', invite.id);
      await supabase.from('profiles').update({ role: 'coach', subscription_status: 'active', full_name: name.trim() }).eq('id', session.user.id);
    } else {
      await supabase.from('gym_members').delete().eq('id', invite.id);
    }
    setInvite(null);
  };

  if (!invite) return null;

  return (
    <div style={{ background: 'rgba(255,58,58,0.08)', border: '1px solid rgba(255,58,58,0.2)', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={{ fontSize: 14 }}><strong>{invite.gym_name}</strong> has invited you to join as a coach</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const }}>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Your name"
          style={{
            flex: 1,
            minWidth: 160,
            padding: '7px 12px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--bg)',
            color: 'var(--text)',
            fontFamily: 'Outfit, sans-serif',
            fontSize: 13,
          }}
        />
        <button
          onClick={() => respond(true)}
          disabled={!name.trim()}
          style={{
            background: name.trim() ? '#2ec486' : '#2ec48666',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            padding: '7px 16px',
            fontFamily: 'Outfit, sans-serif',
            fontWeight: 600,
            fontSize: 13,
            cursor: name.trim() ? 'pointer' : 'not-allowed',
          }}
        >
          Accept
        </button>
        <button
          onClick={() => respond(false)}
          style={{
            background: 'none',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '7px 16px',
            color: 'var(--text-dim)',
            fontFamily: 'Outfit, sans-serif',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Decline
        </button>
      </div>
    </div>
  );
}
