import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PricingPlans, { type PricingPlan } from '../components/PricingPlans';
import type { PricingInterval } from '../components/PricingPlans';
import { QAHeader } from '../components/QAShared';
import '../features.css';
import '../landing.css';

const SUPABASE_BASE = import.meta.env.VITE_SUPABASE_URL || 'https://hsiqzmbfulmfxbvbsdwz.supabase.co';
const CHECKOUT_ENDPOINT = SUPABASE_BASE + '/functions/v1/create-checkout';

/**
 * /pricing — the standalone product chooser, reachable signed in or out
 * (the landing page's pricing section only exists for signed-out visitors,
 * so links like the /examples CTA need a destination that works for both).
 *
 *   - Signed out: anonymous create-checkout straight to Stripe, same flow
 *     as the landing page cards.
 *   - Signed in: /checkout?plan=…&interval=…, the account-tied flow, which
 *     auto-triggers Stripe for new subscribers and shows the proration
 *     preview for existing ones.
 */
export default function PricingPage({ signedIn = false }: { signedIn?: boolean }) {
  const navigate = useNavigate();
  const [busyPlan, setBusyPlan] = useState<PricingPlan | null>(null);

  useEffect(() => {
    document.body.classList.add('feature-body');
    document.title = 'Pricing | The Gains Lab';
    return () => {
      document.body.classList.remove('feature-body');
      document.title = 'The Gains Lab';
    };
  }, []);

  const buy = async (plan: PricingPlan, interval: PricingInterval) => {
    if (signedIn) {
      navigate(`/checkout?plan=${plan}&interval=${interval}`);
      return;
    }
    setBusyPlan(plan);
    try {
      const resp = await fetch(CHECKOUT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, interval }),
      });
      const data = await resp.json();
      if (data.url) { window.location.href = data.url; return; }
      if (data.error) alert(data.error);
    } catch { alert('Failed to start checkout'); }
    finally { setBusyPlan(null); }
  };

  return (
    <div>
      <QAHeader signedIn={signedIn} />
      <div className="feature-page" style={{ paddingTop: 36 }}>
        <div className="feature-container" style={{ maxWidth: 920 }}>
          <div className="lp-kicker">Pricing</div>
          <h2 className="lp-h2">Let&rsquo;s make some gains.</h2>
          <p style={{ fontSize: 15, color: 'var(--text-muted)', margin: '0 0 26px' }}>Monthly or quarterly. Cancel anytime.</p>
          <PricingPlans onBuy={buy} busyPlan={busyPlan} />
          <p style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 15, marginTop: 18 }}>
            Every plan includes AI Coach, Nutrition tracking, and training analytics.
          </p>
          {!signedIn && (
            <div style={{ textAlign: 'center', marginTop: 30, color: 'var(--text-dim)', fontSize: 15 }}>
              Not ready to choose? Create a free account and run your evaluation &mdash; no credit card, yours to keep.<br />
              <Link to="/auth?signup=1&next=/profile" className="landing-cta" style={{ marginTop: 14 }}>Get Your Free Evaluation</Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
