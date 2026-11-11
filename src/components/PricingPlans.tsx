import { useState } from 'react';
import { PLANS, type PricingPlan, type PricingInterval } from '../lib/pricingPlans';
export type { PricingPlan, PricingInterval } from '../lib/pricingPlans';

/** Plan copy and prices live in lib/pricingPlans.ts — one source for the
 *  landing page's pricing section, the standalone /pricing chooser and the
 *  welcome intake, so none can drift apart. Styles come from landing.css
 *  (.lp-plans / .lp-plan / .landing-cta), which the host page imports. */

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
      {/* AI Research — the knowledge sub, styled exactly like the plan cards
          above (same centered layout, full-width CTA), rendered under the
          training ladder's 3-up grid. Included with All Access. */}
      <div className="lp-plan" style={{ marginTop: 18 }}>
        <h3 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 6px' }}>AI Research</h3>
        <div style={{ fontSize: 30, fontWeight: 800, margin: '8px 0 2px' }}>{interval === 'monthly' ? '$9.99' : '$24.99'}</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>{interval === 'monthly' ? 'per month' : 'per quarter'}</div>
        <p style={{ color: 'var(--text-dim)', fontSize: 15, margin: '0 0 20px' }}>Talk to the Research — AI answers from the research library, with citations — plus the AI Coach. Included with All Access.</p>
        <button className="landing-cta" style={{ marginTop: 'auto' }} onClick={() => onBuy('ai_research', interval)} disabled={busyPlan !== null}>
          {busyPlan === 'ai_research' ? 'Redirecting…' : 'Choose AI Research'}
        </button>
      </div>
    </>
  );
}
