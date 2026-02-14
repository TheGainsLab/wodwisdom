import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface Invite { id: string; gym_name: string; }

export default function InviteBanner({ session }: { session: Session }) {
  const [invite, setInvite] = useState<Invite | null>(null);

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
      await supabase.from('gym_members').update({ user_id: session.user.id, status: 'active' }).eq('id', invite.id);
      await supabase.from('profiles').update({ role: 'coach', subscription_status: 'active' }).eq('id', session.user.id);
    } else {
      await supabase.from('gym_members').delete().eq('id', invite.id);
    }
    setInvite(null);
  };

  if (!invite) return null;

  return (
    <div style={{ background: 'rgba(255,58,58,0.08)', border: '1px solid rgba(255,58,58,0.2)', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' as const }}>
      <span style={{ fontSize: 14, flex: 1 }}><strong>{invite.gym_name}</strong> has invited you to join as a coach</span>
      <button onClick={() => respond(true)} style={{ background: '#2ec486', color: 'white', border: 'none', borderRadius: 6, padding: '6px 16px', fontFamily: 'Outfit, sans-serif', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Accept</button>
      <button onClick={() => respond(false)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 16px', color: 'var(--text-dim)', fontFamily: 'Outfit, sans-serif', fontSize: 13, cursor: 'pointer' }}>Decline</button>
    </div>
  );
}
