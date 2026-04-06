import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import GainsLogo from '../../components/GainsLogo';
import '../../features.css';

const SUPABASE_BASE = import.meta.env.VITE_SUPABASE_URL || 'https://hsiqzmbfulmfxbvbsdwz.supabase.co';
const CHECKOUT_ENDPOINT = SUPABASE_BASE + '/functions/v1/create-checkout';

const ENGINE_PROGRAMS = [
  {
    name: 'Year of the Engine',
    freq: '5x/week',
    days: 720,
    months: 36,
    description: 'The full 720-day program — 5 sessions per week across 36 months.',
    who: 'Athletes committed to long-term conditioning development.',
    emphasis: 'All 20 training frameworks in a structured progression. Builds every energy system systematically over 36 months.',
  },
  {
    name: 'Year of the Engine (3-Day)',
    freq: '3x/week',
    days: 432,
    months: 36,
    description: 'Same program quality at 3 sessions per week — 432 training days.',
    who: 'Athletes who train conditioning 3 days and use the other days for strength, sport, or recovery.',
    emphasis: 'Same frameworks as the 5-day, fewer sessions per week. Every session still fully calibrated to you.',
  },
  {
    name: 'Engine: Varied Order',
    freq: '5x/week',
    days: 720,
    months: 36,
    description: 'All 720 days in a shuffled sequence for returning athletes.',
    who: 'Athletes who completed Year of the Engine (or part of it) and want fresh stimulus without repeating the same order.',
    emphasis: 'Same workouts, different sequence. Your ML performance data carries over — the AI already knows your engine.',
  },
  {
    name: 'Engine: Varied Order (3-Day)',
    freq: '3x/week',
    days: 432,
    months: 36,
    description: '432 days in a shuffled sequence at 3 sessions per week.',
    who: 'Returning 3-day athletes who want variety.',
    emphasis: 'Shuffled 3-day variant. All calibration data carries over.',
  },
  {
    name: 'VO2 Max (3-Day)',
    freq: '3x/week',
    days: 144,
    months: 12,
    description: 'A 12-month VO2 Max emphasis program.',
    who: 'Athletes focused on raising their aerobic ceiling — max aerobic power, oxygen uptake, and high-output interval capacity.',
    emphasis: 'Heavy on max aerobic power intervals, devour (accumulating work), and infinity (multi-block supra-threshold). Polarized base work for recovery.',
  },
  {
    name: 'VO2 Max (4-Day)',
    freq: '4x/week',
    days: 192,
    months: 12,
    description: 'A 12-month VO2 Max emphasis program at 4 sessions per week.',
    who: 'Athletes who want aggressive VO2 Max development with an extra session per week.',
    emphasis: 'Same VO2 Max focus as the 3-day with more volume — additional MAP and polarized sessions each week.',
  },
  {
    name: 'Hyrox Race Prep (3-Day)',
    freq: '3x/week',
    days: 144,
    months: 12,
    description: 'A 12-month Hyrox race preparation program.',
    who: 'Athletes training for Hyrox or similar functional fitness races.',
    emphasis: 'Towers, synthesis, afterburner, and flux — frameworks that build sustained output, pace changes, and race-specific conditioning.',
  },
  {
    name: 'Hyrox Race Prep (5-Day)',
    freq: '5x/week',
    days: 240,
    months: 12,
    description: 'A 12-month Hyrox race preparation program at 5 sessions per week.',
    who: 'Dedicated Hyrox competitors who want maximum preparation volume.',
    emphasis: 'Full 5-day race prep with towers, synthesis, afterburner, flux, and polarized recovery sessions.',
  },
];

function ProgramsLibrary() {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  return (
    <section className="feature-section">
      <div className="feature-container">
        <h2 className="feature-section-title" style={{ textAlign: 'center', marginBottom: 8 }}>8 programs. One subscription.</h2>
        <p style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 15, marginBottom: 32, maxWidth: 540, margin: '0 auto 32px' }}>
          Every Engine subscription includes access to all programs. Switch anytime — your performance data carries over.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 600, margin: '0 auto' }}>
          {ENGINE_PROGRAMS.map((prog, i) => {
            const expanded = expandedIdx === i;
            return (
              <div
                key={i}
                onClick={() => setExpandedIdx(expanded ? null : i)}
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  padding: '16px 20px',
                  cursor: 'pointer',
                  transition: 'border-color .15s',
                  borderColor: expanded ? 'var(--accent)' : 'var(--border)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: expanded ? 10 : 0 }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#ffffff' }}>{prog.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>{prog.freq} · {prog.months} months</div>
                  </div>
                  <svg
                    width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2"
                    style={{ transition: 'transform .2s', transform: expanded ? 'rotate(180deg)' : 'none', flexShrink: 0 }}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
                {expanded && (
                  <div style={{ animation: 'fadeUp .2s ease' }}>
                    <p style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: 12 }}>
                      {prog.description}
                    </p>
                    <div style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 8 }}>
                      <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Who it's for: </span>
                      <span style={{ color: 'var(--text)' }}>{prog.who}</span>
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                      <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Training emphasis: </span>
                      <span style={{ color: 'var(--text)' }}>{prog.emphasis}</span>
                    </div>
                    <div style={{ marginTop: 10 }}>
                      <span className="engine-badge engine-badge--default">{prog.days} days</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export default function EngineFeaturePage() {
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  const buyEngine = async () => {
    setCheckoutLoading(true);
    try {
      const resp = await fetch(CHECKOUT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'engine', interval: 'monthly' }),
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
    <div className="feature-page">
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
        <span className="feature-hero-badge">Engine</span>
        <h1 className="feature-hero-title">Year of the Engine</h1>
        <p className="feature-hero-sub">The conditioning program that follows you.</p>
        <p className="feature-hero-body">
          Your engine isn't one thing. It's aerobic capacity. Anaerobic power. Efficiency. Repeatability.
        </p>
        <p className="feature-hero-body">
          Year of the Engine uses 20 distinct training frameworks, each targeting a specific adaptation. Machine learning calibrates every session precisely, so every single interval is personalized to you.
        </p>
      </section>

      {/* Know the number */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row">
            <div className="feature-text">
              <h3 style={{ textAlign: 'center' }}>Know the number. Hit the number.</h3>
              <p>
                Day 24. Max Aerobic Power. Goal: 68.4 calories.
              </p>
              <p>
                Once the clock starts, the app becomes your pacing coach. Goals, countdowns, and round
                context stay front and center through fatigue—so you execute the plan and get the stimulus you need.
              </p>
              <img src="/images/pacing-coach.png" alt="Pacing Coach — real-time interval targets and progress tracking" className="feature-img" />
            </div>
          </div>
        </div>
      </section>

      {/* AI adjusts */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row reverse">
            <div className="feature-text">
              <h3 style={{ textAlign: 'center' }}>The AI watches. The program adjusts.</h3>
              <p>
                Target: 14. Actual: 17. The AI recalibrates, and your next session will be harder.
              </p>
              <p>
                The program follows your performance, not a schedule.
              </p>
              <img src="/images/target-vs-actual.png" alt="Target vs Actual output comparison" className="feature-img" />
            </div>

          </div>
        </div>
      </section>

      {/* Engine fingerprint */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row">
            <div className="feature-text">
              <h3 style={{ textAlign: 'center' }}>Your engine has a fingerprint.</h3>
              <p>
                Unmatched detail into how your Engine works, and how it recovers. Ask your coach (or your AI Coach — it's included for Engine athletes) how to use this data in metcons.
              </p>
              <img src="/images/work-rest-ratio.png" alt="Work to rest ratio analytics" className="feature-img" />
            </div>

          </div>
        </div>
      </section>

      {/* Workout taxonomy */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row reverse">
            <div className="feature-text">
              <h3 style={{ textAlign: 'center' }}>Track output across frameworks</h3>
              <p>
                See exactly how your performance varies across energy systems and track improvement in each one independently.
              </p>
              <img src="/images/comparison.png" alt="Output comparison across training types" className="feature-img" />
            </div>

          </div>
        </div>
      </section>

      {/* Heart rate analytics */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row">
            <div className="feature-text">
              <h3 style={{ textAlign: 'center' }}>Heart rate doesn't lie.</h3>
              <p>
                HR analytics—avg HR, peak HR, efficiency, load—give you the data to train smarter, not just harder.
              </p>
            </div>
            <img src="/images/HR-analytics.png" alt="HR Analytics — average heart rate by day type" className="feature-img" />
          </div>
        </div>
      </section>

      {/* Framework balance */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row">
            <div className="feature-text">
              <h3 style={{ textAlign: 'center' }}>See what the AI sees</h3>
              <p>
                Track your training distribution across energy systems — the same data the AI uses to update your training.
              </p>
              <img src="/images/sessions.png" alt="Sessions by day type analytics" className="feature-img" />
            </div>

          </div>
        </div>
      </section>

      {/* Programs library */}
      <ProgramsLibrary />

      {/* Footer CTA */}
      <section className="feature-footer-cta">
        <h2>Year of the Engine — $29.99/mo</h2>
        <p className="feature-footer-details">
          AI Coach included. Machine learning calibration. Pacing coach. Full conditioning analytics.
        </p>
        <div className="feature-footer-actions">
          <button className="feature-cta" onClick={buyEngine} disabled={checkoutLoading}>{checkoutLoading ? 'Redirecting...' : 'Get Started'}</button>
          <Link to="/#pricing" className="feature-cta-secondary">Back to Pricing</Link>
        </div>
      </section>

      <footer className="feature-footer"><GainsLogo /></footer>
    </div>
  );
}
