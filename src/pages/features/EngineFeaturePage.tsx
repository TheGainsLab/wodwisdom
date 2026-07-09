import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import GainsLogo from '../../components/GainsLogo';
import '../../features.css';

const SUPABASE_BASE = import.meta.env.VITE_SUPABASE_URL || 'https://hsiqzmbfulmfxbvbsdwz.supabase.co';
const CHECKOUT_ENDPOINT = SUPABASE_BASE + '/functions/v1/create-checkout';

const ENGINE_PROGRAMS = [
  {
    name: 'Year of the Engine - Classic',
    freq: '5x/week',
    description: 'The original conditioning super-cycle. 720 days, 5 sessions per week, 36 months — 12 three-month cycles, each adding another layer to your capacity across all 20 training frameworks. Builds exceptional work capacity for any task.',
  },
  {
    name: 'Year of the Engine - Classic (3-Day)',
    freq: '3x/week',
    description: 'The original super-cycle, three days a week. Every phase, every framework, every adaptation — built for athletes who are training for more than one thing at once. Exceptional capacity without the five-day commitment.',
  },
  {
    name: 'Engine Mini Cycle',
    freq: '5x/week',
    description: 'The original super-cycle in four-week micro-cycles. All 20 frameworks in a year, then harder variations as you progress. Your ML data and personalized calibration carry over — and if you\u2019ve been through YoE before, this is a more intense progression through familiar territory.',
  },
  {
    name: 'Engine Mini Cycle (3-Day)',
    freq: '3x/week',
    description: 'Train the three day version of super-cycle in four-week micro-cycles. All 20 frameworks in a year, then harder variations as you progress. Your ML data and personalized calibration carry over — and if you\u2019ve been through YoE before, this is a more intense progression through familiar territory.',
  },
  {
    name: 'VO3 (3-Day)',
    freq: '3x/week',
    description: 'VO2 Max, three days a week. VO3 targets your aerobic ceiling — max aerobic power, oxygen uptake, and high-output interval capacity — across 12 months of structured progression. Heavy on MAP intervals, accumulation work, and multi-block supra-threshold efforts. Polarized base work keeps recovery honest. Built for athletes who want to raise the ceiling, not just train under it.',
  },
  {
    name: 'VO2+2 (4-Day)',
    freq: '4x/week',
    description: 'VO2 Max with more room to work. Four days a week — two high-intensity VO2 sessions to build a more powerful engine, two Zone 2 sessions to build a bigger tank. 12 months of structured progression that develops both simultaneously. For athletes who want aggressive VO2 Max development without sacrificing aerobic endurance.',
  },
  {
    name: 'Hyrox Race Prep (3-Day)',
    freq: '3x/week',
    description: 'Twelve months of race-specific conditioning, three days a week. Built around the demands of Hyrox — sustained output, pace transitions, and the ability to keep moving when it gets uncomfortable. Frameworks targeting every layer of race fitness: power, synthesis, and the capacity to finish strong. For athletes who race Hyrox or want to.',
  },
  {
    name: 'Hyrox Race Prep (5-Day)',
    freq: '5x/week',
    description: 'The full race prep block, five days a week. Same Hyrox-specific frameworks as the 3-day — sustained output, pace transitions, race-finish capacity — with two additional sessions that build the aerobic foundation underneath. For dedicated competitors who want to arrive at the start line with nothing left to prove in training.',
  },
];

function ProgramsLibrary() {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  return (
    <section className="feature-section">
      <div className="feature-container">
        <h2 className="feature-section-title" style={{ textAlign: 'center', marginBottom: 8 }}>8 programs. One subscription.</h2>
        <p style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 15, marginBottom: 32, maxWidth: 540, margin: '0 auto 32px' }}>
          Each program arranges the 20 frameworks toward a different goal. Pick the one that fits — and switch anytime. Your performance data carries over, so your coach never starts from scratch.
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
                    <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>{prog.freq}</div>
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
                    <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, margin: 0 }}>
                      {prog.description}
                    </p>
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
  const [interval, setInterval] = useState<'monthly' | 'quarterly'>('monthly');

  const buyEngine = async () => {
    setCheckoutLoading(true);
    try {
      const resp = await fetch(CHECKOUT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'engine', interval }),
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
        <h1 className="feature-hero-title">Year of the Engine</h1>
        <p className="feature-hero-sub">The conditioning program that follows you.</p>
        <p className="feature-hero-body">
          Your engine isn't one thing. It's aerobic capacity. Anaerobic power. Efficiency. Repeatability.
        </p>
        <p className="feature-hero-body">
          Year of the Engine runs 20 distinct training frameworks, each targeting a specific adaptation — and your coach calibrates every interval to you.
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
                Once the clock starts, the app becomes your pacer. Goals, countdowns, and round
                context stay front and center through fatigue — so you execute the plan and get the stimulus you need.
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
                See how your engine produces power — and how it recovers. Bring the data to your coach, or ask the AI Coach directly: it's included for every Engine athlete.
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
              <h3 style={{ textAlign: 'center' }}>Track output across energy systems</h3>
              <p>
                See exactly how your performance varies across energy systems — and watch each one improve independently.
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
                HR analytics — avg, peak, efficiency, load — so you know what a session cost you.
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
                Track your training distribution across energy systems — the same data the AI uses to update your program.
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
        <h2>Year of the Engine — {interval === 'monthly' ? '$29.99/mo' : '$74.99/qtr'}</h2>
        <p className="feature-footer-details">
          AI Coach included. Machine learning calibration. Pacing coach. Full conditioning analytics.
        </p>
        <div style={{ display: 'flex', maxWidth: 280, margin: '0 auto 20px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <button type="button" style={{ flex: 1, padding: '10px 0', border: 'none', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer', background: interval === 'monthly' ? 'var(--accent)' : 'transparent', color: interval === 'monthly' ? 'white' : 'var(--text-dim)', transition: 'all .15s' }} onClick={() => setInterval('monthly')}>Monthly</button>
          <button type="button" style={{ flex: 1, padding: '10px 0', border: 'none', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer', background: interval === 'quarterly' ? 'var(--accent)' : 'transparent', color: interval === 'quarterly' ? 'white' : 'var(--text-dim)', transition: 'all .15s' }} onClick={() => setInterval('quarterly')}>Quarterly</button>
        </div>
        <div className="feature-footer-actions">
          <button className="feature-cta" onClick={buyEngine} disabled={checkoutLoading}>{checkoutLoading ? 'Redirecting...' : 'Get Started'}</button>
        </div>
      </section>

      <footer className="feature-footer"><GainsLogo /></footer>
    </div>
  );
}
