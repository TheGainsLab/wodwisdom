import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import GainsLogo from '../components/GainsLogo';

/**
 * /welcome — the once-per-account orientation screen (founder spec,
 * 2026-10-08). A brand-new confirmed account lands here before anything
 * else: no nav, no tabs, just the three-step story. Each step carries a
 * "Got it" acknowledgment; Start My Profile unlocks only when all three
 * are checked — three taps of deliberate reading at the moment of peak
 * attention. Deliberately ONE screen, not a carousel: one screen gets
 * read, three get skipped.
 *
 * The seen-flag (profiles.welcome_seen_at) is set on the CTA tap and the
 * WelcomeGate in App.tsx never routes here again. The resident Home
 * welcome card then carries the same story until the user's evaluation
 * exists — the pair covers both "guaranteed first contact" and "still
 * there tomorrow."
 */

const STEPS: Array<{ title: string; body: string }> = [
  {
    title: 'Your profile',
    body: 'Your lifts, skills, and times. Estimates are OK. Whatever you skip stays out of the analysis.',
  },
  {
    title: 'Your free AI evaluation',
    body: 'A candid read of your fitness: strengths, gaps, and an optimal training strategy. Yours to keep.',
  },
  {
    title: 'AI Coach',
    body: 'Complete your profile and the answers are personalized to you.',
  },
];

export default function WelcomePage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [gotIt, setGotIt] = useState<boolean[]>([false, false, false]);
  const [starting, setStarting] = useState(false);
  const allChecked = gotIt.every(Boolean);

  const toggle = (i: number) =>
    setGotIt((prev) => prev.map((v, j) => (j === i ? !v : v)));

  const start = async () => {
    if (!allChecked || starting) return;
    setStarting(true);
    // Best-effort flag write — a failed write must never trap the user on
    // the welcome screen (the gate also treats an existing evaluation as
    // "oriented", so a persistently failing write self-heals at step 2).
    try {
      await supabase
        .from('profiles')
        .update({ welcome_seen_at: new Date().toISOString() })
        .eq('id', session.user.id);
    } catch {
      /* proceed regardless */
    }
    try { sessionStorage.setItem(`welcome-done:${session.user.id}`, '1'); } catch { /* ignore */ }
    navigate('/profile', { replace: true });
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg, #0b0b0d)', display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: 'min(480px, 100%)', padding: 'calc(36px + env(safe-area-inset-top, 0px)) 18px 40px', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 26 }}>
          <GainsLogo />
        </div>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--accent)', borderRadius: 14, padding: '20px 16px 18px' }}>
          <h2 style={{ margin: '0 0 16px', fontSize: 17, color: 'var(--text)' }}>
            Welcome — here's how The Gains Lab works
          </h2>

          {STEPS.map((s, i) => (
            <div key={i}>
              <div style={{ display: 'flex', gap: 10 }}>
                <span
                  aria-hidden
                  style={{
                    flex: 'none', width: 22, height: 22, borderRadius: '50%', marginTop: 2,
                    background: 'var(--surface2, #1d1d21)', border: '1px solid var(--border)',
                    color: 'var(--accent)', fontWeight: 800, fontSize: 12,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {i + 1}
                </span>
                <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-dim)' }}>
                  <strong style={{ color: 'var(--text)' }}>{s.title}</strong> — {s.body}
                </p>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '6px 0 12px' }}>
                <button
                  type="button"
                  onClick={() => toggle(i)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontFamily: 'inherit',
                    color: gotIt[i] ? '#2ec486' : 'var(--text-muted)',
                    background: 'none', cursor: 'pointer',
                    border: `1px solid ${gotIt[i] ? '#2ec486' : 'var(--border)'}`,
                    borderRadius: 999, padding: '4px 12px',
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 14, height: 14, border: '1.5px solid currentColor', borderRadius: 4,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10,
                    }}
                  >
                    {gotIt[i] ? '✓' : ''}
                  </span>
                  Got it
                </button>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={start}
            disabled={!allChecked || starting}
            style={{
              display: 'block', width: '100%', marginTop: 6, border: 'none', borderRadius: 10,
              padding: '13px 0', fontSize: 15, fontWeight: 700, fontFamily: 'inherit',
              transition: 'all .2s',
              cursor: allChecked ? 'pointer' : 'default',
              ...(allChecked
                ? { background: 'var(--accent)', color: '#fff', boxShadow: '0 0 18px rgba(255,58,58,.35)' }
                : { background: 'var(--surface2, #1d1d21)', color: 'var(--text-muted)', border: '1px solid var(--border)' }),
            }}
          >
            {starting ? 'Opening your profile…' : allChecked ? 'Start my profile →' : 'Start my profile'}
          </button>
          {!allChecked && (
            <div style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--text-muted)', marginTop: 8 }}>
              Tap “Got it” on each step to continue
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
