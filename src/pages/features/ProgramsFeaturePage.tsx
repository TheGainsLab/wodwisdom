import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import GainsLogo from '../../components/GainsLogo';
import '../../features.css';
import '../../landing.css';

const SUPABASE_BASE = import.meta.env.VITE_SUPABASE_URL || 'https://hsiqzmbfulmfxbvbsdwz.supabase.co';
const CHECKOUT_ENDPOINT = SUPABASE_BASE + '/functions/v1/create-checkout';

const bodyP: React.CSSProperties = { color: 'var(--text-dim)', fontSize: 15.5, lineHeight: 1.6, maxWidth: '62ch', margin: '0 0 14px' };
const bold: React.CSSProperties = { color: 'var(--text)', fontWeight: 700 };

// The logged-Fran context card — data-shaped HTML, matching the mock.
function FranCard() {
  const rows = [
    ['Fran', '3:42'],
    ['Percentile', '82nd'],
    ['Avg power', '297 W · 3.4 W/kg'],
    ['Time domain', 'Sprint · unbroken thrusters'],
  ];
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '22px 24px', maxWidth: 430 }}>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, letterSpacing: '1.1px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 10 }}>
        Logged result
      </div>
      {rows.map(([k, v], i) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5, padding: '7px 0', borderBottom: i === rows.length - 1 ? 'none' : '1px solid var(--border)' }}>
          <span style={{ color: 'var(--text-dim)' }}>{k}</span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: 'var(--text)' }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

export default function ProgramsFeaturePage() {
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [interval, setInterval] = useState<'monthly' | 'quarterly'>('monthly');

  const buyProgramming = async () => {
    setCheckoutLoading(true);
    try {
      const resp = await fetch(CHECKOUT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'programming', interval }),
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
        <h1 className="feature-hero-title">AI Programming</h1>
        <p className="feature-hero-sub" style={{ fontSize: 'clamp(17px,2.6vw,22px)', fontWeight: 700, color: 'var(--accent)' }}>
          We build your entire training around you.
        </p>
        <p className="feature-hero-body" style={{ marginBottom: 12 }}>
          Complete your evaluation — just a few minutes — tell us your goals and schedule, and the AI builds your individualized program, a full month at a time, warm-ups to cool-downs.
        </p>
        <p className="feature-hero-body" style={{ marginBottom: 12 }}>
          Then AI Coach stays with you. Need to change a workout? Ask. Need cues, pacing, strategy, or training advice? Ask. It knows your program, your history, and your numbers, so the guidance is specific to you.
        </p>
        <p className="feature-hero-body">
          And when the month ends, the next one is built from what you actually did.
        </p>
      </section>

      {/* Why AI — quiet band */}
      <section className="feature-section" style={{ borderTop: '1px solid var(--border)', padding: '46px 0' }}>
        <div className="feature-container">
          <div className="lp-kicker lp-kicker-solo">Why AI Works for Programming</div>
          <div style={{ maxWidth: '62ch', margin: '0 auto' }}>
            <p style={bodyP}>A truly individualized program depends on a huge amount of information — your strength, skills, conditioning, goals, schedule, history, results, feedback, and progress.</p>
            <p style={bodyP}>AI is exceptionally well suited to that. And this isn't a rules engine or a decision tree — it reasons across your history and results, so what you get is shaped by what you've actually done.</p>
            <p style={bodyP}>It's grounded in our training methodology and draws on the same information a skilled coach would consider — so its decisions reflect sound coaching principles rather than generic fitness ideas.</p>
            <p style={{ ...bodyP, ...bold, marginBottom: 0 }}>That&rsquo;s what makes this more than generated workouts. It&rsquo;s programming built from the full picture of you.</p>
          </div>
        </div>
      </section>

      {/* Level 1 — Built around you */}
      <section className="feature-section" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="feature-container">
          <div className="lp-kicker">Personalization · Level 1</div>
          <h2 className="lp-h2">Your evaluation and your goals drive everything.</h2>
          <p style={bodyP}>It starts with a full evaluation of your lifts, skills, and conditioning — measured against 15 million competition event scores.</p>
          <p style={bodyP}>Then you tell us what you're after, how you like to train, and how many days you want to train each week.</p>
          <p style={{ ...bodyP, ...bold }}>The evaluation tells us where you are. You tell us where you want to go. Your program is the shortest distance between the two.</p>
          <p style={bodyP}>The evaluation is free, takes just a few minutes, and is yours to keep — whether or not you train with us.</p>
          <Link className="lp-link" to="/examples?tab=evaluations" style={{ fontSize: 13.5 }}>Read a full evaluation &rarr;</Link>
        </div>
      </section>

      {/* The Output — inside a training day */}
      <section className="feature-section" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="feature-container">
          <div className="lp-kicker">The Output</div>
          <h2 className="lp-h2">Inside a training day.</h2>
          <p style={{ ...bodyP, marginTop: 16 }}>Every day breaks down into blocks — warm-up to cool-down — each with loads, targets, and coaching cues computed from your numbers. Skills, Strength, Technical Work, Accessories, MetCons. Weights in your units, percentages from your actual maxes, metcons scaled to your capacity.</p>
          <p style={bodyP}>Volume and intensity are balanced to produce adaptation, not burnout.</p>
          <p style={{ ...bodyP, ...bold }}>Not a template with your name on it. Training built from your numbers, your priorities, and your goals.</p>
          <Link className="lp-link" to="/examples?tab=programming" style={{ fontSize: 13.5, display: 'inline-block', marginTop: 10 }}>See a full training day &rarr;</Link>
        </div>
      </section>

      {/* Level 2 — Coach on every block */}
      <section className="feature-section" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="feature-container">
          <div className="lp-kicker">Personalization · Level 2</div>
          <h2 className="lp-h2">Coach, every block.</h2>
          <p style={{ ...bodyP, marginTop: 16 }}>Every block has a built-in AI Coach. Tap the button in any block and get guidance for what you're about to do — before you even have to ask — informed by your profile, evaluation, training history, and today's session.</p>
          <img
            src="/images/programming-coach-change.webp"
            alt="AI Coach conversation — the athlete's rower broke, the coach proposes an Echo Bike swap with Apply and Keep buttons"
            loading="lazy"
            className="feature-img"
            style={{ maxWidth: 420, margin: '10px 0 24px' }}
          />
          <p style={bodyP}>Need to change something? Tell the coach: &ldquo;My rower's broken — can we change the MetCon and keep the stimulus?&rdquo; or &ldquo;I'm traveling this week — can we adjust to hotel workouts with dumbbells and a jump rope?&rdquo;</p>
          <p style={bodyP}>The coach proposes the revised block. You review it and tap Apply.</p>
          <p style={{ ...bodyP, ...bold, marginBottom: 0 }}>Your program updates — and stays your program.</p>
        </div>
      </section>

      {/* Context — data comes to life */}
      <section className="feature-section" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="feature-container">
          <div className="lp-kicker">Context</div>
          <h2 className="lp-h2">Most apps save a score. We use it.</h2>
          <p style={bodyP}>A result usually sits in a log — a number from a session that's already over.</p>
          <p style={bodyP}>This is different. The Gains Lab captures what the result means — percentile, power, time domain, movement demands — and puts that information back into the system.</p>
          <div style={{ margin: '20px 0 24px' }}>
            <FranCard />
          </div>
          <p style={bodyP}>It can recalibrate targets, influence future sessions, and help decide what comes next.</p>
          <p style={{ ...bodyP, ...bold, marginBottom: 0 }}>It doesn't just know you finished Fran in 3:42. It knows what that says about your fitness — and remembers it when making the next decision.</p>
        </div>
      </section>

      {/* Level 3 — It never stops adapting */}
      <section className="feature-section" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="feature-container">
          <div className="lp-kicker">Personalization · Level 3</div>
          <h2 className="lp-h2">It never stops adapting.</h2>
          <p style={bodyP}>When you complete a month, the next one generates automatically from what you log — scores, feedback, RPEs, and any outside training. Weaknesses you've improved rotate out of focus; the next priority rotates in.</p>
          <p style={{ ...bodyP, ...bold }}>Month one is built from your evaluation. Every month after is built from evidence.</p>
          <Link className="lp-link" to="/examples?tab=programming">See real programs and evaluations &rarr;</Link>
        </div>
      </section>

      {/* Pricing */}
      <section className="feature-section" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="feature-container">
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 28, textAlign: 'center', maxWidth: 430, margin: '0 auto' }}>
            <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>AI Programming</h2>
            <div style={{ fontSize: 32, fontWeight: 800, margin: '6px 0 2px' }}>{interval === 'monthly' ? '$29.99' : '$74.99'}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>{interval === 'monthly' ? 'per month' : 'per quarter'}</div>
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
            <p style={{ color: 'var(--text-dim)', fontSize: 14, margin: '0 0 18px' }}>Includes AI Coach, Nutrition tracking, and training analytics.</p>
            <button className="feature-cta" onClick={buyProgramming} disabled={checkoutLoading}>
              {checkoutLoading ? 'Redirecting…' : 'Start AI Programming'}
            </button>
          </div>
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13.5, marginTop: 22 }}>
            Not ready? <Link to="/auth?signup=1&next=/profile" style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>Run your free evaluation</Link> — no credit card, yours to keep.
          </div>
        </div>
      </section>

      <footer className="feature-footer"><GainsLogo /></footer>
    </div>
  );
}
