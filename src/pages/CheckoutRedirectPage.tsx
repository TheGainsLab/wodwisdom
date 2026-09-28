import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import GainsLogo from '../components/GainsLogo';
import '../features.css';

const SUPABASE_BASE = import.meta.env.VITE_SUPABASE_URL || 'https://hsiqzmbfulmfxbvbsdwz.supabase.co';
const CHECKOUT_ENDPOINT = SUPABASE_BASE + '/functions/v1/create-checkout';

const PLANS = {
  programming: { name: 'AI Programming', monthly: '$29.99', quarterly: '$74.99' },
  engine: { name: 'AI Year of the Engine', monthly: '$29.99', quarterly: '$74.99' },
  all_access: { name: 'All Access', monthly: '$49.99', quarterly: '$119.99' },
} as const;
type Plan = keyof typeof PLANS;
type Interval = 'monthly' | 'quarterly';

/**
 * Signed-out /checkout?plan=… (email CTAs, shared links). With a valid plan
 * it shows one decision — Monthly or Quarterly — then goes straight to the
 * Stripe payment screen via the anonymous create-checkout flow; an explicit
 * ?interval= skips the chooser. No/invalid plan still lands on /features
 * (preserving the July '26 recovery-email-leak fix: never fall silently to
 * the landing page).
 */
export default function CheckoutRedirectPage() {
  const [searchParams] = useSearchParams();
  const planParam = searchParams.get('plan');
  const plan: Plan | null = planParam && planParam in PLANS ? (planParam as Plan) : null;
  const intervalParam = searchParams.get('interval');
  const presetInterval: Interval | null =
    intervalParam === 'quarterly' ? 'quarterly' : intervalParam === 'monthly' ? 'monthly' : null;
  const [redirecting, setRedirecting] = useState<Interval | null>(null);
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    document.body.classList.add('feature-body');
    return () => document.body.classList.remove('feature-body');
  }, []);

  const startCheckout = async (interval: Interval) => {
    if (!plan || started.current) return;
    started.current = true;
    setRedirecting(interval);
    setFailed(false);
    try {
      const resp = await fetch(CHECKOUT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, interval }),
      });
      const data = await resp.json();
      if (data.url) { window.location.replace(data.url); return; }
      started.current = false;
      setRedirecting(null);
      setFailed(true);
    } catch {
      started.current = false;
      setRedirecting(null);
      setFailed(true);
    }
  };

  useEffect(() => {
    if (!plan) {
      window.location.replace('/features');
      return;
    }
    if (presetInterval) void startCheckout(presetInterval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, presetInterval]);

  if (!plan) return null;
  const info = PLANS[plan];

  const intervalBtn = (interval: Interval, price: string, per: string) => (
    <button
      onClick={() => void startCheckout(interval)}
      disabled={redirecting !== null}
      style={{
        display: 'block', width: '100%', maxWidth: 320, margin: '0 auto',
        background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 10,
        padding: '14px 24px', fontFamily: "'Outfit', sans-serif", fontSize: 16, fontWeight: 700,
        cursor: redirecting ? 'default' : 'pointer', opacity: redirecting && redirecting !== interval ? 0.55 : 1,
      }}
    >
      {redirecting === interval ? 'Taking you to checkout…' : `${price} ${per}`}
    </button>
  );

  return (
    <div className="feature-page" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24 }}>
      <GainsLogo />
      {presetInterval && !failed ? (
        <p style={{ color: 'var(--text-dim)', fontSize: 16, marginTop: 24 }}>Taking you to checkout…</p>
      ) : (
        <>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: '28px 0 6px', color: 'var(--text)' }}>{info.name}</h1>
          <p style={{ color: 'var(--text-dim)', fontSize: 15, margin: '0 0 24px' }}>How would you like to pay?</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 320 }}>
            {intervalBtn('monthly', info.monthly, 'per month')}
            {intervalBtn('quarterly', info.quarterly, 'per quarter')}
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 18 }}>Cancel anytime.</p>
          {failed && (
            <p style={{ color: 'var(--text-dim)', fontSize: 14.5, margin: '18px 0 0', maxWidth: '46ch' }}>
              We couldn't start checkout just now — try again, or email{' '}
              <a href="mailto:coach@thegainslab.com" style={{ color: 'var(--accent)' }}>coach@thegainslab.com</a> and a human will sort it out.
            </p>
          )}
          <Link to="/features" style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 26, textDecoration: 'none' }}>
            See everything that's included →
          </Link>
        </>
      )}
    </div>
  );
}
