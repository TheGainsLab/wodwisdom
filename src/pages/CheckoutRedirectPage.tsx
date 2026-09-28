import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import GainsLogo from '../components/GainsLogo';
import '../features.css';

const SUPABASE_BASE = import.meta.env.VITE_SUPABASE_URL || 'https://hsiqzmbfulmfxbvbsdwz.supabase.co';
const CHECKOUT_ENDPOINT = SUPABASE_BASE + '/functions/v1/create-checkout';

const VALID_PLANS = ['programming', 'engine', 'all_access'] as const;
type Plan = (typeof VALID_PLANS)[number];

/**
 * Signed-out /checkout?plan=… (email CTAs, shared links): go straight to
 * Stripe via the anonymous create-checkout flow the feature pages use,
 * instead of dumping the visitor on the features hub and losing the plan
 * they clicked. No/invalid plan still lands on /features (preserving the
 * July '26 recovery-email-leak fix: never fall silently to the landing page).
 */
export default function CheckoutRedirectPage() {
  const [searchParams] = useSearchParams();
  const planParam = searchParams.get('plan');
  const plan: Plan | null = (VALID_PLANS as readonly string[]).includes(planParam ?? '') ? (planParam as Plan) : null;
  const interval = searchParams.get('interval') === 'quarterly' ? 'quarterly' : 'monthly';
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    document.body.classList.add('feature-body');
    return () => document.body.classList.remove('feature-body');
  }, []);

  useEffect(() => {
    if (!plan) {
      window.location.replace('/features');
      return;
    }
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const resp = await fetch(CHECKOUT_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan, interval }),
        });
        const data = await resp.json();
        if (data.url) { window.location.replace(data.url); return; }
        setFailed(true);
      } catch {
        setFailed(true);
      }
    })();
  }, [plan, interval]);

  return (
    <div className="feature-page" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24 }}>
      <GainsLogo />
      {!failed ? (
        <p style={{ color: 'var(--text-dim)', fontSize: 16, marginTop: 24 }}>Taking you to checkout…</p>
      ) : (
        <>
          <p style={{ color: 'var(--text-dim)', fontSize: 16, margin: '24px 0 16px', maxWidth: '46ch' }}>
            We couldn't start checkout just now. You can try again from the product page — or email{' '}
            <a href="mailto:coach@thegainslab.com" style={{ color: 'var(--accent)' }}>coach@thegainslab.com</a> and a human will sort it out.
          </p>
          <Link to="/features" className="feature-cta">See plans</Link>
        </>
      )}
    </div>
  );
}
