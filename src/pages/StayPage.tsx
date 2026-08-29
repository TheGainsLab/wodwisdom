import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';

// /stay — the cancellation save-offer page. Opened from a signed link in the
// founder's manual retention email. Works signed-out: the HMAC token in the
// URL is the authorization (verified server-side by the save-offer function),
// and the page never mutates anything on load — only the button's explicit
// accept call does, which an email scanner can't trigger (scanners don't run
// page scripts, and prefetching the page only hits the read-only status call).

// ALL amounts come from the server (which reads Stripe's real upcoming
// invoice). The page does NO price math — currentCents is what they actually
// pay next, discountedCents is the server's promised post-accept amount, and
// newTotalCents is the Stripe-verified result after accepting.
type OfferState =
  | { phase: 'loading' }
  | { phase: 'offer'; currentCents: number; discountedCents: number; currency: string; interval: string; pct: number; cancelScheduled: boolean }
  | { phase: 'accepted'; newTotalCents: number; currency: string; interval: string; pct: number }
  | { phase: 'already'; currentCents: number; currency: string; interval: string }
  | { phase: 'lapsed' }
  | { phase: 'invalid' }
  | { phase: 'error' };

function money(cents: number, currency: string): string {
  const sym = currency === 'usd' ? '$' : `${currency.toUpperCase()} `;
  return `${sym}${(cents / 100).toFixed(2)}`;
}

const S = {
  wrap: {
    minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#111214', padding: 24, boxSizing: 'border-box',
    fontFamily: "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif",
  } as React.CSSProperties,
  card: {
    background: '#1b1c1f', border: '1px solid #2a2b2f', borderRadius: 16,
    padding: '40px 32px', maxWidth: 420, width: '100%', textAlign: 'center', color: '#f2f2f0',
  } as React.CSSProperties,
  brand: { fontWeight: 800, letterSpacing: 2, fontSize: 13, color: '#ff3a3a', marginBottom: 28 } as React.CSSProperties,
  h1: { fontSize: 22, margin: '0 0 12px', fontWeight: 700 } as React.CSSProperties,
  p: { color: '#a8a69e', lineHeight: 1.6, fontSize: 15, margin: '0 0 14px' } as React.CSSProperties,
  strong: { color: '#f2f2f0' } as React.CSSProperties,
  price: { margin: '26px 0', fontSize: 20 } as React.CSSProperties,
  old: { textDecoration: 'line-through', color: '#6d6b64', marginRight: 12 } as React.CSSProperties,
  new: { color: '#f2f2f0', fontWeight: 800, fontSize: 26 } as React.CSSProperties,
  badge: {
    display: 'block', marginTop: 8, fontSize: 12, fontWeight: 700, letterSpacing: 1,
    textTransform: 'uppercase', color: '#2ec486',
  } as React.CSSProperties,
  button: {
    background: '#ff3a3a', color: '#fff', border: 'none', padding: '14px 32px', borderRadius: 10,
    fontSize: 16, fontWeight: 700, cursor: 'pointer', width: '100%', fontFamily: 'inherit',
  } as React.CSSProperties,
  fine: { fontSize: 12, color: '#6d6b64', marginTop: 16 } as React.CSSProperties,
};

export default function StayPage() {
  const [params] = useSearchParams();
  const u = params.get('u') ?? '';
  const t = params.get('t') ?? '';
  const [state, setState] = useState<OfferState>({ phase: 'loading' });
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    if (!u || !t) { setState({ phase: 'invalid' }); return; }
    (async () => {
      const { data, error } = await supabase.functions.invoke('save-offer', {
        body: { action: 'status', u, t },
      });
      if (error || !data) {
        // invoke surfaces non-2xx as error; a 403 means bad token.
        setState({ phase: (error as { context?: { status?: number } } | null)?.context?.status === 403 ? 'invalid' : 'error' });
        return;
      }
      const d = data as { state?: string; current_cents?: number; discounted_cents?: number; currency?: string; interval?: string; discount_pct?: number; cancel_scheduled?: boolean; error?: string };
      if (d.error) { setState({ phase: d.error === 'invalid_link' ? 'invalid' : 'error' }); return; }
      if (d.state === 'lapsed') { setState({ phase: 'lapsed' }); return; }
      if (typeof d.current_cents !== 'number') { setState({ phase: 'error' }); return; }
      if (d.state === 'already') {
        setState({ phase: 'already', currentCents: d.current_cents, currency: d.currency ?? 'usd', interval: d.interval ?? 'month' });
      } else {
        setState({
          phase: 'offer',
          currentCents: d.current_cents,
          discountedCents: d.discounted_cents ?? d.current_cents,
          currency: d.currency ?? 'usd',
          interval: d.interval ?? 'month',
          pct: d.discount_pct ?? 20,
          cancelScheduled: d.cancel_scheduled === true,
        });
      }
    })();
  }, [u, t]);

  const accept = async () => {
    if (state.phase !== 'offer' || accepting) return;
    setAccepting(true);
    const { data, error } = await supabase.functions.invoke('save-offer', {
      body: { action: 'accept', u, t },
    });
    setAccepting(false);
    const d = (data ?? {}) as { state?: string; new_total_cents?: number; current_cents?: number; currency?: string; interval?: string; discount_pct?: number };
    if (error || d.state === undefined) { setState({ phase: 'error' }); return; }
    if (d.state === 'already') {
      setState({ phase: 'already', currentCents: d.current_cents ?? state.currentCents, currency: state.currency, interval: state.interval });
      return;
    }
    if (d.state !== 'accepted' || typeof d.new_total_cents !== 'number') { setState({ phase: 'error' }); return; }
    // Show the Stripe-verified post-accept amount, not our own arithmetic.
    setState({ phase: 'accepted', newTotalCents: d.new_total_cents, currency: state.currency, interval: state.interval, pct: state.pct });
  };

  return (
    <div style={S.wrap}>
      <div style={S.card}>
        <div style={S.brand}>THE GAINS LAB</div>

        {state.phase === 'loading' && <p style={S.p}>Loading your offer…</p>}

        {state.phase === 'offer' && (
          <>
            <h1 style={S.h1}>Stay at {state.pct}% off — forever</h1>
            <p style={S.p}>
              {state.cancelScheduled
                ? 'Your subscription is currently set to cancel at the end of this billing period. One click keeps your training going and locks in the new price — permanently.'
                : 'Your subscription is active. One click locks in the new price — permanently, as offered.'}
            </p>
            <div style={S.price}>
              <span style={S.old}>{money(state.currentCents, state.currency)}/{state.interval}</span>
              <span style={S.new}>{money(state.discountedCents, state.currency)}/{state.interval}</span>
              <span style={S.badge}>{state.pct}% off · forever</span>
            </div>
            <button style={{ ...S.button, opacity: accepting ? 0.7 : 1 }} onClick={() => void accept()} disabled={accepting}>
              {accepting ? 'One moment…' : 'Keep my subscription'}
            </button>
            <p style={S.fine}>The discount applies from your next invoice and never expires. Questions? Just reply to the email.</p>
          </>
        )}

        {state.phase === 'accepted' && (
          <>
            <h1 style={S.h1}>You're all set 🎉</h1>
            <p style={S.p}>
              Your subscription continues at{' '}
              <strong style={S.strong}>{money(state.newTotalCents, state.currency)}/{state.interval}</strong>
              {' '}— {state.pct}% off, permanently, starting with your next invoice.
            </p>
            <p style={S.p}>Glad you're staying. See you in the gym.</p>
          </>
        )}

        {state.phase === 'already' && (
          <>
            <h1 style={S.h1}>Your discount is already active</h1>
            <p style={S.p}>
              Your subscription continues at{' '}
              <strong style={S.strong}>{money(state.currentCents, state.currency)}/{state.interval}</strong>
              {' '}— nothing more to do.
            </p>
          </>
        )}

        {state.phase === 'lapsed' && (
          <>
            <h1 style={S.h1}>This offer window has passed</h1>
            <p style={S.p}>Your subscription has already ended, so this link can't restore it automatically. Reply to the email and we'll sort you out directly.</p>
          </>
        )}

        {state.phase === 'invalid' && (
          <>
            <h1 style={S.h1}>This link didn't check out</h1>
            <p style={S.p}>The link is incomplete or expired. Reply to the email and we'll take care of it by hand.</p>
          </>
        )}

        {state.phase === 'error' && (
          <>
            <h1 style={S.h1}>Something went wrong</h1>
            <p style={S.p}>We couldn't process that just now. Reply to the email and we'll apply the offer by hand.</p>
          </>
        )}
      </div>
    </div>
  );
}
