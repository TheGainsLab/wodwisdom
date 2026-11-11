import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { markWelcomeSeen } from '../lib/welcome';
import GainsLogo from '../components/GainsLogo';
import { PLANS } from '../lib/pricingPlans';
import { useEntitlements } from '../hooks/useEntitlements';

/**
 * /welcome — the once-per-account intake for an account that has bought
 * nothing (founder spec, 2026-11-11, replacing the four-step "Got it"
 * orientation of 2026-10-08; plan in docs/welcome_intake_plan.md).
 *
 * People sign up with nothing. The screen meets them there and gives every
 * destination its own door, plans first because the goal is to get people
 * to buy programs:
 *
 *   GET A PROGRAM   AI Programming · All Access · Year of the Engine
 *                   → the payment page for THAT plan (checkout?plan=…)
 *   OR START FREE   Free AI evaluation → /profile
 *                   AI Coach → /chat      Research Library → /knowledge
 *
 * Names, prices and blurbs come from PricingPlans.PLANS — one source with
 * the pricing page. No "Got it" taps: tapping ANY row is the acknowledgment
 * (profiles.welcome_seen_at + the per-session flag), and the WelcomeGate in
 * App.tsx never routes here again.
 *
 * A PAID account never sees this screen — the gate routes it by entitlement
 * (Programming / All Access → /profile, Engine → the Engine setup). The one
 * exception is Coach- or Research-only, whose free rows read "included in
 * your plan".
 */

const KICKER: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase',
  color: 'var(--text-muted)', margin: '14px 0 8px',
};
const ROW_BASE: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
  borderRadius: 10, padding: '12px 14px', marginBottom: 8, color: 'var(--text)',
  fontFamily: 'inherit', cursor: 'pointer',
};

export default function WelcomePage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const { hasEntitlement } = useEntitlements(session.user.id);
  const [busy, setBusy] = useState<string | null>(null);
  const uid = session.user.id;

  const go = async (key: string, to: string) => {
    if (busy) return;
    setBusy(key);
    await markWelcomeSeen(uid);
    navigate(to, { replace: true });
  };

  const coachIncluded = hasEntitlement('ai_chat');
  const researchIncluded = hasEntitlement('research_chat');

  const free: Array<{ key: string; name: string; blurb: string; to: string }> = [
    { key: 'evaluation', name: 'Free AI evaluation', blurb: 'Lifts, skills, times. A candid read of your fitness, yours to keep.', to: '/profile' },
    { key: 'coach', name: 'AI Coach', blurb: coachIncluded ? 'Training, nutrition, recovery. Included in your plan.' : 'Training, nutrition, recovery. Three questions free.', to: '/chat' },
    { key: 'library', name: 'Research Library', blurb: researchIncluded ? 'The science of training, in plain language. Ask it anything — included in your plan.' : 'The science of training, in plain language. Open to read.', to: '/knowledge' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg, #0b0b0d)', display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: 'min(480px, 100%)', padding: 'calc(36px + env(safe-area-inset-top, 0px)) 18px 40px', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 26 }}>
          <GainsLogo />
        </div>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--accent)', borderRadius: 14, padding: '20px 16px 18px' }}>
          <h2 style={{ margin: '0 0 4px', fontSize: 17, color: 'var(--text)' }}>Welcome — pick your path</h2>
          <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text-dim)' }}>
            Everything below is yours to start now. Change your mind any time.
          </p>

          <div style={KICKER}>Get a program</div>
          {PLANS.map((p) => (
            <button
              key={p.plan}
              type="button"
              disabled={busy !== null}
              onClick={() => go(p.plan, `/checkout?plan=${p.plan}&interval=monthly`)}
              style={{
                ...ROW_BASE,
                background: 'var(--surface2, #18181c)',
                border: `1px solid ${p.feat ? 'var(--accent)' : 'var(--border)'}`,
                boxShadow: p.feat ? '0 0 14px rgba(255,58,58,.18)' : undefined,
                opacity: busy && busy !== p.plan ? 0.7 : 1,
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14.5, fontWeight: 700 }}>
                  {p.name}
                  {p.badge && (
                    <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 800, letterSpacing: '.5px', textTransform: 'uppercase', color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 999, padding: '1px 7px', marginLeft: 6, verticalAlign: 'middle' }}>
                      {p.badge}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.45, marginTop: 2 }}>{p.blurb}</div>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', textAlign: 'right' }}>
                {p.monthly}
                <small style={{ display: 'block', fontWeight: 400, fontSize: 11, color: 'var(--text-muted)' }}>/month</small>
              </div>
            </button>
          ))}
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '2px 2px 0', lineHeight: 1.5 }}>
            Programs and All Access are built from your evaluation — buy now, build your profile next.
          </div>

          <div style={KICKER}>Or start free</div>
          {free.map((f) => (
            <button
              key={f.key}
              type="button"
              disabled={busy !== null}
              onClick={() => go(f.key, f.to)}
              style={{ ...ROW_BASE, background: 'none', border: '1px solid var(--border)', padding: '11px 14px', opacity: busy && busy !== f.key ? 0.7 : 1 }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{f.name}</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.45, marginTop: 2 }}>{f.blurb}</div>
              </div>
              <span aria-hidden style={{ color: 'var(--text-muted)', fontSize: 16 }}>›</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
