import { useEffect, useState } from 'react';
import { SUPABASE_URL } from '../lib/supabase';

/**
 * /unsubscribe?u=<user_id>&t=<hmac> — the same-domain front door for email
 * opt-outs. Automated emails mint links HERE (so every link in an email
 * matches the sending domain — the Resend deliverability flag, Sep '26); this
 * page relays the params to the email-unsubscribe edge function, which owns
 * the token check and the opt-out write. Old supabase.co links keep working —
 * the function serves both.
 */
export default function UnsubscribePage() {
  const [state, setState] = useState<'working' | 'done' | 'invalid' | 'error'>('working');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const u = params.get('u') ?? '';
    const t = params.get('t') ?? '';
    if (!u || !t) { setState('invalid'); return; }
    fetch(`${SUPABASE_URL}/functions/v1/email-unsubscribe?u=${encodeURIComponent(u)}&t=${encodeURIComponent(t)}`)
      .then(resp => {
        if (resp.ok) setState('done');
        else if (resp.status === 400 || resp.status === 403) setState('invalid');
        else setState('error');
      })
      .catch(() => setState('error'));
  }, []);

  const copy = {
    working: { title: 'One moment…', body: 'Taking you off the list.' },
    done: {
      title: "You're unsubscribed",
      body: "You won't receive automated emails from The Gains Lab anymore. Account and billing emails (receipts, password resets) still arrive as needed.",
    },
    invalid: {
      title: 'Invalid link',
      body: "This unsubscribe link didn't check out. Reply to any of our emails and we'll take you off the list by hand.",
    },
    error: {
      title: 'Something went wrong',
      body: "We couldn't process that just now. Reply to any of our emails and we'll take you off the list by hand.",
    },
  }[state];

  return (
    <div style={{ fontFamily: "'Outfit', -apple-system, sans-serif", maxWidth: 480, margin: '80px auto', padding: '0 24px', textAlign: 'center' }}>
      <h2 style={{ fontSize: 22, marginBottom: 12 }}>{copy.title}</h2>
      <p style={{ color: 'var(--text-muted, #5a584f)', lineHeight: 1.6 }}>{copy.body}</p>
    </div>
  );
}
