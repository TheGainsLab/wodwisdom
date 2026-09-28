import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import GainsLogo from '../../components/GainsLogo';
import FeatureFooter from '../../components/FeatureFooter';
import '../../features.css';
import '../../landing.css';

const SUPABASE_BASE = import.meta.env.VITE_SUPABASE_URL || 'https://hsiqzmbfulmfxbvbsdwz.supabase.co';
const CHECKOUT_ENDPOINT = SUPABASE_BASE + '/functions/v1/create-checkout';

const bodyP: React.CSSProperties = { color: 'var(--text-dim)', fontSize: 16, lineHeight: 1.6, maxWidth: '62ch', margin: '0 0 14px' };
const bold: React.CSSProperties = { color: 'var(--text)', fontWeight: 700 };

// The 22 training structures and the span of the slow→fast fiber spectrum
// each one trains (0 = pure slow-twitch endurance, 100 = all-out power).
// Gradient entries emphasize their slow end and fade toward the fast end.
const SPECTRUM: { key: string; lo: number; hi: number; gradient?: boolean }[] = [
  { key: 'Endurance', lo: 8, hi: 16 },
  { key: 'Threshold', lo: 42, hi: 50 },
  { key: 'Anaerobic', lo: 86, hi: 96 },
  { key: 'Time Trial', lo: 56, hi: 66 },
  { key: 'Devour', lo: 42, hi: 56 },
  { key: 'Descending Devour', lo: 44, hi: 56 },
  { key: 'Ascending Devour', lo: 46, hi: 64 },
  { key: 'Towers', lo: 18, hi: 62 },
  { key: 'Max Aerobic Power', lo: 50, hi: 64 },
  { key: 'Hybrid Aerobic', lo: 52, hi: 64 },
  { key: 'Rocket Races A', lo: 56, hi: 68 },
  { key: 'Rocket Races B', lo: 56, hi: 68 },
  { key: 'Interval', lo: 40, hi: 80 },
  { key: 'Ascending', lo: 56, hi: 86 },
  { key: 'Atomic', lo: 70, hi: 88 },
  { key: 'Hybrid Anaerobic', lo: 70, hi: 84 },
  { key: 'Flux', lo: 10, hi: 45, gradient: true },
  { key: 'Flux Stages', lo: 10, hi: 52, gradient: true },
  { key: 'Polarized', lo: 8, hi: 92, gradient: true },
  { key: 'Infinity', lo: 46, hi: 82, gradient: true },
  { key: 'Afterburner', lo: 40, hi: 92, gradient: true },
  { key: 'Synthesis', lo: 12, hi: 96, gradient: true },
];

function SpectrumPoster() {
  const rows = [...SPECTRUM].sort((a, b) => (a.lo + a.hi) / 2 - (b.lo + b.hi) / 2);
  const fade = 'linear-gradient(90deg,#000 0%,rgba(0,0,0,0.3) 100%)';
  return (
    <div className="eng-poster">
      <div className="eng-axis"><span>Slow-Twitch</span><span>Fast-Twitch</span></div>
      <div className="eng-rows">
        <div>
          {rows.map(s => {
            const left = Math.max(0, Math.min(100, s.lo));
            const width = Math.max(3, Math.min(100 - left, s.hi - s.lo));
            const lit: React.CSSProperties = { clipPath: `inset(0 ${100 - (left + width)}% 0 ${left}%)` };
            if (s.gradient) { lit.maskImage = fade; lit.WebkitMaskImage = fade; }
            return (
              <div key={s.key} className="eng-prow">
                <div className="eng-nm">{s.key}</div>
                <div className="eng-track"><div className="base" /><div className="lit" style={lit} /></div>
              </div>
            );
          })}
        </div>
        <div className="eng-zones">
          <div className="eng-zone-fill" />
          <div className="eng-zone-line" style={{ left: '50%' }} />
          <div className="eng-zone-line" style={{ left: '75%' }} />
          <div className="eng-zone-label">Metcon Zone</div>
        </div>
      </div>
      <div style={{ textAlign: 'center', fontSize: 13.5, color: 'var(--text)', marginTop: 14 }}>
        Each bar shows the range of fibers a structure trains.
      </div>
    </div>
  );
}

const ENGINE_PROGRAMS = [
  {
    name: 'AI Year of the Engine - Classic',
    freq: '5x/week',
    description: 'The original conditioning super-cycle. 720 days, 5 sessions per week, 36 months — 12 three-month cycles, each adding another layer to your capacity across all 22 training structures. Builds exceptional work capacity for any task.',
  },
  {
    name: 'AI Year of the Engine - Classic (3-Day)',
    freq: '3x/week',
    description: 'The original super-cycle, three days a week. Every phase, every structure, every adaptation — built for athletes who are training for more than one thing at once. Exceptional capacity without the five-day commitment.',
  },
  {
    name: 'Engine Mini Cycle',
    freq: '5x/week',
    description: 'The original super-cycle in four-week micro-cycles. All 22 structures in a year, then harder variations as you progress. Your ML data and personalized calibration carry over — and if you’ve been through YoE before, this is a more intense progression through familiar territory.',
  },
  {
    name: 'Engine Mini Cycle (3-Day)',
    freq: '3x/week',
    description: 'Train the three day version of super-cycle in four-week micro-cycles. All 22 structures in a year, then harder variations as you progress. Your ML data and personalized calibration carry over — and if you’ve been through YoE before, this is a more intense progression through familiar territory.',
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
    description: 'Twelve months of race-specific conditioning, three days a week. Built around the demands of Hyrox — sustained output, pace transitions, and the ability to keep moving when it gets uncomfortable. Structures targeting every layer of race fitness: power, synthesis, and the capacity to finish strong. For athletes who race Hyrox or want to.',
  },
  {
    name: 'Hyrox Race Prep (5-Day)',
    freq: '5x/week',
    description: 'The full race prep block, five days a week. Same Hyrox-specific structures as the 3-day — sustained output, pace transitions, race-finish capacity — with two additional sessions that build the aerobic foundation underneath. For dedicated competitors who want to arrive at the start line with nothing left to prove in training.',
  },
];

function ProgramsLibrary() {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  return (
    <section className="feature-section" style={{ borderTop: '1px solid var(--border)' }}>
      <div className="feature-container">
        <div className="lp-kicker">Programs</div>
        <h2 className="lp-h2">8 programs. One subscription.</h2>
        <p style={{ ...bodyP, marginBottom: 24 }}>
          Each program arranges the 22 structures toward a different goal. Pick the one that fits — and switch anytime. Your performance data carries over, so your coach never starts from scratch.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 600 }}>
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
                    <p style={{ fontSize: 14.5, color: 'var(--text)', lineHeight: 1.6, margin: 0 }}>
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
        <h1 className="feature-hero-title">AI Year of the Engine</h1>
        <p className="feature-hero-sub" style={{ fontSize: 'clamp(17px,2.6vw,22px)', fontWeight: 700, color: 'var(--accent)' }}>
          The conditioning program that follows you.
        </p>
        <p className="feature-hero-body" style={{ marginBottom: 12 }}>
          Your engine isn't one thing. It's aerobic capacity. Anaerobic power. Efficiency. Repeatability.
        </p>
        <p className="feature-hero-body">
          AI Year of the Engine runs 22 distinct training structures, each targeting a specific adaptation. Every training day is calibrated to you, and built to run alongside whatever else you train.
        </p>
      </section>

      {/* Spectrum */}
      <section className="feature-section" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="feature-container">
          <div className="lp-kicker">Conditioning, Not Cardio</div>
          <h2 className="lp-h2" style={{ marginBottom: 20 }}>Train the entire spectrum of muscle fibers.</h2>
          <SpectrumPoster />
          <p style={{ ...bodyP, marginTop: 16, marginBottom: 0 }}>
            AI Year of the Engine trains the full spectrum — from aerobic base to all-out sprint. <span style={bold}>Most programs concentrate in the Metcon Zone, which can leave important adaptations undertrained.</span>
          </p>
        </div>
      </section>

      {/* Level 1 — pacing */}
      <section className="feature-section" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="feature-container">
          <div className="lp-kicker">Personalization · Level 1</div>
          <h2 className="lp-h2">Know the number. Hit the number.</h2>
          <img
            src="/images/engine-day-timer.webp"
            alt="The built-in work timer mid-session — elapsed time, a personal calorie goal, and block and round position"
            loading="lazy"
            className="feature-img"
            style={{ maxWidth: 420, margin: '16px 0 20px' }}
          />
          <p style={bodyP}>Open any training day and your target is waiting for you, calculated from your time trials and your recent performance.</p>
          <p style={{ ...bodyP, ...bold }}>Every session — even every interval — has a target built for you, so you know exactly what to aim for to get the intended stimulus.</p>
          <Link className="lp-link" to="/examples?tab=engine">See a real athlete's training day &rarr;</Link>
        </div>
      </section>

      {/* Level 2 — the AI learns */}
      <section className="feature-section" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="feature-container">
          <div className="lp-kicker">Personalization · Level 2</div>
          <h2 className="lp-h2">The AI learns. The program adjusts.</h2>
          <img
            src="/images/engine-analytics-targets.webp"
            alt="Targets vs Actual analytics — Sep 17 target 15.3 vs actual 16.3, then Sep 24 target 16.3 vs actual 18.4"
            loading="lazy"
            className="feature-img"
            style={{ maxWidth: 420, margin: '16px 0 20px' }}
          />
          <p style={bodyP}>Look closely: Sep 17&rsquo;s actual became Sep 24&rsquo;s target. Beat the number, and the next one rises to meet you.</p>
          <p style={bodyP}>The AI learns from what you actually did and updates the targets ahead. And every month, a time trial re-baselines the whole system — every target recalibrated to your current fitness, not the athlete you were when you started.</p>
          <p style={{ ...bodyP, ...bold, marginBottom: 0 }}>The program follows your performance, not just the calendar.</p>
        </div>
      </section>

      {/* Level 3 — sequencing */}
      <section className="feature-section" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="feature-container">
          <div className="lp-kicker">Personalization · Level 3</div>
          <h2 className="lp-h2">Your results shape what comes next.</h2>
          <p style={bodyP}>After your first ten sessions, the AI compares your results against your goals and adjusts the training ahead — changing the sequence and emphasis to give you the stimulus you need next.</p>
          <p style={bodyP}>It can also account for training you log outside the Engine, so your upcoming work reflects the full picture.</p>
          <p style={{ ...bodyP, ...bold, marginBottom: 0 }}>Same track. Sequenced around you.</p>
        </div>
      </section>

      {/* Coach strip */}
      <section className="feature-section" style={{ borderTop: '1px solid var(--border)', padding: '44px 0' }}>
        <div className="feature-container">
          {/* Header-less section: enlarged like the other solo kickers, but
              left-aligned to match this strip (per the mock review). */}
          <div className="lp-kicker" style={{ fontSize: 20, letterSpacing: '2.4px', marginBottom: 16 }}>AI Coach · Always Available</div>
          <p style={bodyP}>When you have questions — pacing, strategy, or what today&rsquo;s session is for — <span style={bold}>AI Coach is built into every training day.</span></p>
          <p style={bodyP}>It knows your numbers, your history, and the work in front of you, so the answer is specific to you and the session you&rsquo;re doing.</p>
          <p style={bodyP}>Included with every plan.</p>
          <img
            src="/images/engine-day-pacing.webp"
            alt="AI Coach pacing answer citing the athlete's previous session, RPE, and heart rate"
            loading="lazy"
            className="feature-img"
            style={{ maxWidth: 420, marginTop: 10 }}
          />
        </div>
      </section>

      {/* Modality */}
      <section className="feature-section" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="feature-container">
          <div className="lp-kicker">Your Equipment</div>
          <h2 className="lp-h2">Any engine. Your engine.</h2>
          <p style={bodyP}>Rower, bike erg, echo bike, ski erg, treadmill — or the open road. AI Year of the Engine runs on whatever you've got: pick your equipment when you start a session, and if you'd rather run than ride, run.</p>
          <img
            src="/images/engine-day-equipment.webp"
            alt="Equipment selection — modality and unit pickers with a per-machine time-trial baseline"
            loading="lazy"
            className="feature-img"
            style={{ maxWidth: 420, margin: '16px 0 4px' }}
          />
          <p style={{ ...bodyP, marginTop: 14, marginBottom: 0 }}>Your pacing is calibrated per machine, from your own time trials. Do a time trial on the rower and your rowing targets are yours. A running time trial unlocks running targets. <span style={bold}>Switch equipment whenever you want — the program follows you there.</span></p>
        </div>
      </section>

      {/* Analytics teaser */}
      <section className="feature-section" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="feature-container">
          <div className="lp-kicker">Analytics</div>
          <h2 className="lp-h2">The AI sees everything. So do you.</h2>
          <p style={bodyP}>Every session feeds your analytics — power fingerprint, energy-system breakdown, heart rate, training distribution. The same data the AI uses to update your program, open for your inspection.</p>
          <Link className="lp-link" to="/examples?tab=engine">See real Engine analytics &rarr;</Link>
        </div>
      </section>

      {/* Programs library */}
      <ProgramsLibrary />

      {/* Pricing */}
      <section className="feature-section" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="feature-container">
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 28, textAlign: 'center', maxWidth: 430, margin: '0 auto' }}>
            <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>AI Year of the Engine</h2>
            <div style={{ fontSize: 32, fontWeight: 800, margin: '6px 0 2px' }}>{interval === 'monthly' ? '$29.99' : '$74.99'}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>{interval === 'monthly' ? 'per month' : 'per quarter'}</div>
            <div style={{ display: 'flex', maxWidth: 240, margin: '0 auto 16px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              {(['monthly', 'quarterly'] as const).map(iv => (
                <button
                  key={iv}
                  type="button"
                  style={{ flex: 1, padding: '8px 0', border: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer', background: interval === iv ? 'var(--accent)' : 'transparent', color: interval === iv ? 'white' : 'var(--text-dim)', transition: 'all .15s' }}
                  onClick={() => setInterval(iv)}
                >
                  {iv === 'monthly' ? 'Monthly' : 'Quarterly'}
                </button>
              ))}
            </div>
            <p style={{ color: 'var(--text-dim)', fontSize: 15, margin: '0 0 18px' }}>Includes AI Coach, Nutrition tracking, and training analytics.</p>
            <button className="feature-cta" onClick={buyEngine} disabled={checkoutLoading}>
              {checkoutLoading ? 'Redirecting…' : 'Start AI Year of the Engine'}
            </button>
          </div>
          <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 14.5, marginTop: 22 }}>
            Not ready? <Link to="/auth?signup=1&next=/profile" style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>Run your free evaluation</Link> — no credit card, yours to keep.
          </div>
        </div>
      </section>

      <FeatureFooter links={[{ to: '/examples?tab=engine', label: 'Real Examples' }, { to: '/features/programs', label: 'AI Programming' }]} />
    </div>
  );
}
