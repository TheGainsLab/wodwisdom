import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import GainsLogo from '../../components/GainsLogo';
import '../../features.css';

const SUPABASE_BASE = import.meta.env.VITE_SUPABASE_URL || 'https://hsiqzmbfulmfxbvbsdwz.supabase.co';
const CHECKOUT_ENDPOINT = SUPABASE_BASE + '/functions/v1/create-checkout';

export default function ProgramsFeaturePage() {
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  const buyProgramming = async () => {
    setCheckoutLoading(true);
    try {
      const resp = await fetch(CHECKOUT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'programming', interval: 'monthly' }),
      });
      const data = await resp.json();
      if (data.url) { window.location.href = data.url; return; }
      if (data.error) alert(data.error);
    } catch { alert('Failed to start checkout'); }
    finally { setCheckoutLoading(false); }
  };

  useEffect(() => {
    document.body.classList.add('feature-body');
    return () => document.body.classList.remove('feature-body');
  }, []);

  return (
    <div className="feature-page feature-page-single">
      {/* Header */}
      <header className="feature-header">
        <div className="feature-header-inner">
          <Link to="/" className="feature-brand">
            <GainsLogo className="feature-brand-name" />
          </Link>
          <nav className="feature-nav">
            <Link to="/features">All Features</Link>
            <a href="/#pricing">Pricing</a>
          </nav>
          <Link to="/auth" className="feature-signin-btn">Sign In</Link>
        </div>
      </header>

      {/* Hero */}
      <section className="feature-hero">
        <span className="feature-hero-badge">Programs</span>
        <h1 className="feature-hero-title">AI Programming</h1>
        <p className="feature-hero-sub">
          The program that follows you.
        </p>
        <p className="feature-hero-body">
          You train on what's actually holding you back — so you get fitter faster. Built from your strengths, your gaps, and your goals, then rebuilt as you improve.
        </p>
      </section>

      {/* Step 1 — Evaluation */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row reverse">
            <div className="feature-text">
              <h3 style={{ textAlign: 'center' }}>Your Evaluation</h3>
              <p>
                Your evaluation pinpoints where you rank and what's holding you back — in specifics, not vibes.
              </p>
              <img
                src="/images/weak-eval.png"
                alt="A GAINS profile evaluation calling out strengths, weaknesses, and training priorities"
                loading="lazy"
                className="feature-img"
                style={{ maxWidth: 560 }}
              />
              <p style={{ marginTop: 28 }}>
                Then your program attacks exactly that. Every weakness above becomes work on your calendar — same gaps, now a plan.
              </p>
              <img src="/images/Program-week.png" alt="A week of programming targeting your weaknesses" className="feature-img" style={{ maxWidth: 560 }} />
              <p style={{ marginTop: 28 }}>
                Nothing generic. Nothing guessed. The program is the answer to your evaluation.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Step 2 — Inside a Training Day */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row">
            <div className="feature-text">
              <h3 style={{ textAlign: 'center' }}>Inside a Training Day</h3>
              <p>
                Every day breaks down into blocks — warm-up to cooldown — each with loads, targets, and coaching cues.
              </p>
              <img src="/images/Single-Day.png" alt="A single training day — warm-up, skills, strength, accessory, metcon, and cool-down" className="feature-img" style={{ maxWidth: 560 }} />
              <p style={{ marginTop: 24 }}>
                But a good coach tells you why. Tap into any session and you get the intent behind it — what each block is building, and how the pieces fit together.
              </p>
              <img src="/images/training-intent2.png" alt="Coach guidance for a training day — intent, pacing, and what to watch for" className="feature-img" style={{ maxWidth: 560 }} />
              <p style={{ marginTop: 24 }}>
                Go deeper on any movement: how to pace it, what good looks like, and the exact faults to avoid.
              </p>
              <img src="/images/metcon-coach2.png" alt="Movement-level coaching — pacing, what good looks like, and faults to avoid" className="feature-img" style={{ maxWidth: 560 }} />
              <p style={{ marginTop: 24 }}>
                This is the difference between a list of movements and a coach who explains them.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Step 3 — AI Coaches, You're in Control */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row reverse">
            <div className="feature-text">
              <h3 style={{ textAlign: 'center' }}>You're in Control</h3>
              <p>
                Life happens. Equipment breaks, your shoulder's cranky, you've got 40 minutes instead of 60. Tell your coach what changed — in plain language.
              </p>
              <p>
                You ask, in plain language
              </p>
              <img src="/images/swap1.png" alt="Ask the AI to swap a movement" className="feature-img" style={{ maxWidth: 560 }} />
              <p style={{ marginTop: 24 }}>
                It swaps the movement and keeps the stimulus — the row becomes an Echo Bike, the aerobic demand stays exactly the same.
              </p>
              <img src="/images/swap2.png" alt="The AI swaps the movement while preserving the stimulus" className="feature-img" style={{ maxWidth: 560 }} />
              <p style={{ marginTop: 24 }}>
                And the new movement comes fully coached, to your numbers — not a generic substitution, but a re-coached block built for you.
              </p>
              <img src="/images/swap3.png" alt="The swapped movement comes coached and scaled to your numbers" className="feature-img" style={{ maxWidth: 560 }} />
              <p style={{ marginTop: 24 }}>
                No group program can do this. Your coach does it in seconds.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Fully Personalized */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row">
            <div className="feature-text">
              <h3 style={{ textAlign: 'center' }}>Built Around Your Week</h3>
              <p>
                Three days or six. Forty-five minutes or ninety. Your goals, your level, your injuries. You set the constraints up front — and the program is built to fit them, not the other way around.
              </p>
              <img src="/images/context-goals.png" alt="Setting your training days, time available, and limits so the program fits your life" className="feature-img" style={{ maxWidth: 560 }} />
              <p style={{ marginTop: 24 }}>
                A plan that fits your life is a plan you'll actually keep.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Compare */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row reverse">
            <div className="feature-text">
              <h3>AI Programming — $29.99/mo</h3>
              <p>
                Includes AI Coach and Nutrition.
              </p>
              <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                <button className="feature-cta" onClick={buyProgramming} disabled={checkoutLoading}>{checkoutLoading ? 'Redirecting...' : 'Get Started'}</button>
                <Link to="/pricing" className="feature-cta-secondary">Back to Pricing</Link>
              </div>
              <p style={{ marginTop: 16, fontStyle: 'italic' }}>
                The program that follows you.
              </p>
            </div>
          </div>
        </div>
      </section>

      <footer className="feature-footer"><GainsLogo /></footer>
    </div>
  );
}
