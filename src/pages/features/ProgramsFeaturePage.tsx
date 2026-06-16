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
          Built from your strength, skills, conditioning, and competition history — then aimed at the adaptations that move your fitness the most. You train on what's actually holding you back, so you get fitter faster.
        </p>
      </section>

      {/* Step 1 — Evaluation */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row reverse">
            <div className="feature-text">
              <h3 style={{ textAlign: 'center' }}>Step 1 — Your evaluation</h3>
              <p>
                Your evaluation pinpoints where you rank, what's holding you back, and what to fix first.
              </p>
              <img
                src="/images/weak-eval.png"
                alt="A GAINS profile evaluation calling out strengths, weaknesses, and training priorities"
                loading="lazy"
                className="feature-img"
                style={{ maxWidth: 560 }}
              />
              <p style={{ marginTop: 28 }}>
                Your program is built to attack exactly that. The AI takes your profile and goals and turns every gap into work on your calendar — your Olympic lifts, your gymnastics, your aerobic engine.
              </p>
              <img src="/images/Program-week.png" alt="A week of programming targeting your weaknesses" className="feature-img" style={{ maxWidth: 560 }} />
            </div>
          </div>
        </div>
      </section>

      {/* Step 2 — Inside a Training Day */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row">
            <div className="feature-text">
              <h3 style={{ textAlign: 'center' }}>Step 2 — Inside a Training Day</h3>
              <p>
                Every day breaks down into blocks — warm-up to cooldown — each with loads, targets, and coaching cues.
              </p>
              <img src="/images/Single-Day.png" alt="A single training day — warm-up, skills, strength, accessory, metcon, and cool-down" className="feature-img" style={{ maxWidth: 560 }} />
              <p style={{ marginTop: 24 }}>
                Tap Coach on any block and you get the why, how to pace it, and what to watch for — not just a list of movements.
              </p>
              <img src="/images/coach-day.png" alt="Coach guidance for a training day — intent, pacing, and what to watch for" className="feature-img" style={{ maxWidth: 560 }} />
            </div>
          </div>
        </div>
      </section>

      {/* Step 5 — Ongoing */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row reverse">
            <div className="feature-text">
              <h3 style={{ textAlign: 'center' }}>Step 5 — Ongoing</h3>
              <p>
                AI is with you every time you train.
              </p>
              <p>
                Log your results and the program adapts. Flag weaknesses and the AI adjusts. Demonstrate proficiency and the challenges increase. Update your profile anytime.
              </p>
              <p>
                Every month, AI evaluates your performance and updates your evaluation, then generates another month of training. Your evaluation history tells the story of your progress.
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
