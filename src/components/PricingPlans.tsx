import { useState } from 'react';

export type PricingPlan = 'programming' | 'engine' | 'all_access';
export type PricingInterval = 'monthly' | 'quarterly';

/** The single source of truth for public plan copy and prices — rendered on
 *  the landing page's pricing section and the standalone /pricing chooser,
 *  so the two can never drift apart. Styles come from landing.css
 *  (.lp-plans / .lp-plan / .landing-cta), which the host page imports. */
const PLANS: {
  plan: PricingPlan; name: string; monthly: string; quarterly: string;
  blurb: string; cta: string; feat: boolean; badge: string;
}[] = [
  { plan: 'programming', name: 'AI Programming', monthly: '$29.99', quarterly: '$74.99', blurb: 'Individualized training built around your evaluation, goals, and progress.', cta: 'Choose Programming', feat: false, badge: '' },
  { plan: 'all_access', name: 'All Access', monthly: '$49.99', quarterly: '$119.99', blurb: 'AI Programming + AI Year of the Engine.', cta: 'Get All Access', feat: true, badge: 'Best Value' },
  { plan: 'engine', name: 'AI Year of the Engine', monthly: '$29.99', quarterly: '$74.99', blurb: 'Our conditioning system, personalized to your fitness and goals.', cta: 'Choose Engine', feat: false, badge: '' },
];

export default function PricingPlans({ onBuy, busyPlan = null }: {
  onBuy: (plan: PricingPlan, interval: PricingInterval) => void;
  busyPlan?: PricingPlan | null;
}) {
  const [interval, setIntervalChoice] = useState<PricingInterval>('monthly');
  return (
    <>
      <div style={{ display: 'flex', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 20, maxWidth: 320 }}>
        {(['monthly', 'quarterly'] as const).map(iv => (
          <button
            key={iv}
            style={{ flex: 1, padding: '10px 0', border: 'none', fontFamily: "'Outfit', sans-serif", fontSize: 14, fontWeight: 600, cursor: 'pointer', background: interval === iv ? 'var(--accent)' : 'transparent', color: interval === iv ? 'white' : 'var(--text-dim)', transition: 'all .15s' }}
            onClick={() => setIntervalChoice(iv)}
          >
            {iv === 'monthly' ? 'Monthly' : 'Quarterly'}
          </button>
        ))}
      </div>
      <div className="lp-plans">
        {PLANS.map(p => (
          <div key={p.plan} className={'lp-plan' + (p.feat ? ' lp-plan-feat' : '')}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 10, minHeight: 14 }}>{p.badge}</div>
            <h3 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 6px' }}>{p.name}</h3>
            <div style={{ fontSize: 30, fontWeight: 800, margin: '8px 0 2px' }}>{interval === 'monthly' ? p.monthly : p.quarterly}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>{interval === 'monthly' ? 'per month' : 'per quarter'}</div>
            <p style={{ color: 'var(--text-dim)', fontSize: 15, margin: '0 0 20px' }}>{p.blurb}</p>
            <button className="landing-cta" style={{ marginTop: 'auto' }} onClick={() => onBuy(p.plan, interval)} disabled={busyPlan !== null}>
              {busyPlan === p.plan ? 'Redirecting…' : p.cta}
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
