import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import GainsLogo from '../components/GainsLogo';
import '../landing.css';

const SUPABASE_BASE = import.meta.env.VITE_SUPABASE_URL || 'https://hsiqzmbfulmfxbvbsdwz.supabase.co';
const CHECKOUT_ENDPOINT = SUPABASE_BASE + '/functions/v1/create-checkout';

const bodyP: React.CSSProperties = { fontSize: 18, lineHeight: 1.7, color: 'var(--text-dim)', marginBottom: 16 };

const FAQ_ITEMS: { q: string; a: React.ReactNode }[] = [
  {
    q: 'How can I try The Gains Lab before paying?',
    a: <>Create a free account and run your fitness evaluation — a full written assessment of where you are and what to prioritize, measured against 15 million competition event scores. No credit card. It's yours to keep whether you subscribe or not.</>,
  },
  {
    q: "What's the difference between AI Programming and AI Year of the Engine?",
    a: 'AI Programming builds your entire training — strength, skills, conditioning — individually, month by month. AI Year of the Engine is our conditioning system: you pick a track, and the AI personalizes every session’s pacing and targets to you. Programming replaces your training; Engine runs alongside it.',
  },
  {
    q: 'What does All Access include?',
    a: 'Everything: AI Programming, AI Year of the Engine, AI Coach, Nutrition tracking, and training analytics — one plan, $120/year less than buying both.',
  },
  {
    q: 'Does every plan include AI Coach?',
    a: 'Yes. Every training plan includes unlimited AI Coach questions, grounded in the methodology and your own training history.',
  },
  {
    q: 'Does it work on my phone?',
    a: 'Yes — The Gains Lab is an installable web app. Open thegainslab.com in your phone’s browser and add it to your home screen. No app store, nothing to download.',
  },
  {
    q: 'What equipment do I need?',
    a: 'A standard functional-fitness setup: barbell, pulling bar, and a conditioning machine (bike, rower, or ski erg — running works too). Your profile records what you have, and programs are built around it.',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes. Cancel in one click from Settings; you keep full access through the end of your billing period, and your training history and PRs are saved if you ever come back.',
  },
  {
    q: 'I have more questions. How do I reach you?',
    a: <>Email <a href="mailto:coach@thegainslab.com" style={{ color: 'var(--accent)' }}>coach@thegainslab.com</a> — a real person reads every message.</>,
  },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [pricingInterval, setPricingInterval] = useState<'monthly' | 'quarterly'>('monthly');
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const goToAuth = () => navigate('/auth');

  // Signed-out checkout: same anonymous create-checkout flow the feature
  // pages use (a /checkout route needs a session and redirects away).
  const buy = async (plan: 'programming' | 'engine' | 'all_access') => {
    setCheckoutLoading(plan);
    try {
      const resp = await fetch(CHECKOUT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, interval: pricingInterval }),
      });
      const data = await resp.json();
      if (data.url) { window.location.href = data.url; return; }
      if (data.error) alert(data.error);
    } catch { alert('Failed to start checkout'); }
    finally { setCheckoutLoading(null); }
  };

  useEffect(() => {
    document.body.classList.add('landing-body');
    return () => document.body.classList.remove('landing-body');
  }, []);

  return (
    <div className="landing-page">
      {/* ===== Header ===== */}
      <header className="landing-header">
        <div className="landing-header-inner">
          <div className="landing-brand">
            <GainsLogo className="landing-brand-name" />
          </div>
          <nav className="landing-nav">
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
            <Link to="/examples">Examples</Link>
          </nav>
          <button className="landing-signin-btn" onClick={goToAuth}>Sign In</button>
        </div>
      </header>

      {/* ===== Hero ===== */}
      <section className="landing-hero" style={{ minHeight: 'auto', padding: '84px 24px 64px' }}>
        <GainsLogo className="landing-hero-logo" />
        <h1 className="landing-hero-title" style={{ fontSize: 'clamp(34px,6vw,58px)' }}>Stop Doing Someone Else's Workout.</h1>
        <p className="landing-hero-sub" style={{ marginBottom: 0 }}>
          The Gains Lab uses AI that knows your data, goals, history, and feedback to deliver truly individualized training.
        </p>
      </section>

      {/* ===== Why AI — quiet band ===== */}
      <section className="landing-explainer" style={{ borderTop: '1px solid var(--border)', padding: '56px 0' }}>
        <div className="landing-container">
          <div className="lp-kicker lp-kicker-solo">Why AI</div>
          {/* Paragraphs read left-aligned on a centered 62ch block; only the
              kicker and the bold thesis line stay centered. */}
          <div style={{ maxWidth: '62ch', margin: '0 auto' }}>
            <p style={{ ...bodyP, fontSize: 16.5 }}>Coaches bring inspiration, leadership, empathy, accountability, and real one-to-one connection.</p>
            <p style={{ ...bodyP, fontSize: 16.5 }}>AI's advantage is information processing. It can compare patterns across enormous datasets and bring the full picture to every programming decision, every time.</p>
            <p style={{ ...bodyP, fontSize: 16.5 }}>A truly individualized program depends on a lot of information — and that information grows every time you train. So we built The Gains Lab around that idea: give AI the full athlete context — your profile, training history, results, goals, and feedback — the information most group programs never use.</p>
            <p style={{ ...bodyP, fontSize: 16.5 }}>But data alone isn't enough. We also trained our AI on the methodology, giving it the coaching principles to make better training decisions.</p>
            <p style={{ ...bodyP, fontSize: 16.5, textAlign: 'center', color: 'var(--text)', fontWeight: 700, marginBottom: 0 }}>
              Give AI the information and the methodology, and personalization becomes possible at a completely different level.
            </p>
          </div>
        </div>
      </section>

      {/* ===== Two Ways to Train ===== */}
      <section id="paths" className="landing-explainer" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="landing-container">
          <div className="lp-kicker">Two Ways to Train</div>
          <h2 className="lp-h2">Pick your path.</h2>
          <p style={{ ...bodyP, fontSize: 16, color: 'var(--text-muted)', maxWidth: '60ch', marginBottom: 12 }}>
            This isn't a workout library with a chatbot. It's an AI-powered training platform that personalizes the work, learns from your results, and coaches you every day.
          </p>
          <p style={{ ...bodyP, fontSize: 16, color: 'var(--text-muted)', maxWidth: '60ch', marginBottom: 12 }}>
            Every plan includes AI Coach — think of it like having a coach by your side. It knows your training history, helps you plan the day, answers workout-specific questions, and can make small adjustments when something needs to change.{' '}
            <Link to="/qa" className="lp-link" style={{ fontSize: 15 }}>See the coach answer real questions &rarr;</Link>
          </p>
          <p style={{ ...bodyP, fontSize: 16, color: 'var(--text)', fontWeight: 700, maxWidth: '60ch', marginBottom: 34 }}>
            Two products. One intelligent system built around you.
          </p>
          <div className="lp-paths">
            <div className="lp-path">
              <h3>AI Programming</h3>
              <p style={{ color: 'var(--text)', fontWeight: 600, marginBottom: 10 }}>Built around you, from day one.</p>
              <p>A complete program shaped by your evaluation, your goals, and your schedule. Replace what you're doing with something made for you.</p>
              <p>Daily coaching guides you through the work. Log your results, and the program evolves as your fitness improves.</p>
              <Link className="lp-link" to="/features/programs">Explore AI Programming &rarr;</Link>
            </div>
            <div className="lp-path">
              <h3>AI Year of the Engine</h3>
              <p style={{ color: 'var(--text)', fontWeight: 600, marginBottom: 10 }}>Your conditioning, not cardio — personalized and coached every day.</p>
              <p>Built to run alongside your other training, not replace it. Keep your strength program, your sport, your gym — Engine handles the conditioning.</p>
              <p>Choose your track, tell us your goals, and AI calibrates every session to you. Log your results and the system adapts, sequencing what comes next to match your fitness and performance.</p>
              <Link className="lp-link" to="/features/engine">Explore AI Year of the Engine &rarr;</Link>
            </div>
          </div>
          <div className="lp-band">
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>Want both? Get All Access.</div>
            <span style={{ color: 'var(--text-dim)', fontSize: 15 }}>AI Programming + AI Year of the Engine for $49.99/month.</span>
            <a className="lp-link" href="#pricing" style={{ marginTop: 4 }}>Get All Access &rarr;</a>
          </div>
        </div>
      </section>

      {/* ===== Personal From Day One ===== */}
      <section className="landing-explainer" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="landing-container">
          <div className="lp-kicker">Personal From Day One</div>
          <div className="lp-proof">
            <div>
              <h2 className="lp-h2">It starts by learning who you are.</h2>
              <p style={{ ...bodyP, fontSize: 16 }}>
                The Gains Lab maps your abilities, history, goals, strengths, and weaknesses — and shows where you stand against 15 million competition event scores. It also identifies your biggest opportunities. This evaluation becomes the foundation of your personalized training.
              </p>
              <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16, margin: '18px 0 22px' }}>
                Even if you decide not to train with us, it's free and yours to keep.
              </p>
              <Link to="/auth?signup=1&next=/profile" className="landing-cta">Get Your Free Evaluation</Link>
            </div>
            <div className="lp-evalcard">
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 12 }}>
                From a real athlete's evaluation
              </div>
              {/* Verbatim from the evaluation on /examples (weaknesses #3,
                  strengths #1) — trims marked with ellipses. Keep it that way:
                  the tag above claims a real excerpt. */}
              <p>&ldquo;Your jerk (265) is barely above your push press (255) — that says <b>the jerk technique, not overhead strength, is what&rsquo;s capping your clean &amp; jerk</b>&hellip; Technique work here is cheap on recovery and high-return.&rdquo;</p>
              <p>&ldquo;A 19:55 5k run, a 6:44 2k row, and a 17:57 5k row at 225 lbs is <b>a real engine</b>&hellip; We keep this sharp with regular touches, but it doesn&rsquo;t need to be pushed while strength is the focus.&rdquo;</p>
              <Link className="lp-link" to="/examples">See real evaluations, programs, and Engine analytics &rarr;</Link>
            </div>
          </div>
        </div>
      </section>

      {/* ===== Pricing ===== */}
      <section id="pricing" className="landing-explainer" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="landing-container">
          <div className="lp-kicker">Pricing</div>
          <h2 className="lp-h2">Let's make some gains.</h2>
          <p style={{ ...bodyP, fontSize: 15, color: 'var(--text-muted)', marginBottom: 26 }}>Monthly or quarterly. Cancel anytime.</p>
          <div style={{ display: 'flex', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 20, maxWidth: 320 }}>
            {(['monthly', 'quarterly'] as const).map(iv => (
              <button
                key={iv}
                style={{ flex: 1, padding: '10px 0', border: 'none', fontFamily: "'Outfit', sans-serif", fontSize: 14, fontWeight: 600, cursor: 'pointer', background: pricingInterval === iv ? 'var(--accent)' : 'transparent', color: pricingInterval === iv ? 'white' : 'var(--text-dim)', transition: 'all .15s' }}
                onClick={() => setPricingInterval(iv)}
              >
                {iv === 'monthly' ? 'Monthly' : 'Quarterly'}
              </button>
            ))}
          </div>
          <div className="lp-plans">
            {[
              { plan: 'programming' as const, name: 'AI Programming', monthly: '$29.99', quarterly: '$74.99', blurb: 'Individualized training built around your evaluation, goals, and progress.', cta: 'Choose Programming', feat: false, badge: '' },
              { plan: 'all_access' as const, name: 'All Access', monthly: '$49.99', quarterly: '$119.99', blurb: 'AI Programming + AI Year of the Engine.', cta: 'Get All Access', feat: true, badge: 'Best Value' },
              { plan: 'engine' as const, name: 'AI Year of the Engine', monthly: '$29.99', quarterly: '$74.99', blurb: 'Our conditioning system, personalized to your fitness and goals.', cta: 'Choose Engine', feat: false, badge: '' },
            ].map(p => (
              <div key={p.plan} className={'lp-plan' + (p.feat ? ' lp-plan-feat' : '')}>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 10, minHeight: 14 }}>{p.badge}</div>
                <h3 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 6px' }}>{p.name}</h3>
                <div style={{ fontSize: 30, fontWeight: 800, margin: '8px 0 2px' }}>{pricingInterval === 'monthly' ? p.monthly : p.quarterly}</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>{pricingInterval === 'monthly' ? 'per month' : 'per quarter'}</div>
                <p style={{ color: 'var(--text-dim)', fontSize: 15, margin: '0 0 20px' }}>{p.blurb}</p>
                <button className="landing-cta" style={{ marginTop: 'auto' }} onClick={() => buy(p.plan)} disabled={checkoutLoading !== null}>
                  {checkoutLoading === p.plan ? 'Redirecting…' : p.cta}
                </button>
              </div>
            ))}
          </div>
          <p style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 15, marginTop: 18 }}>
            Every plan includes AI Coach, Nutrition tracking, and training analytics.
          </p>
          <div style={{ textAlign: 'center', marginTop: 30, color: 'var(--text-dim)', fontSize: 15 }}>
            Not ready to choose? Create a free account and run your evaluation — no credit card, yours to keep.<br />
            <Link to="/auth?signup=1&next=/profile" className="landing-cta" style={{ marginTop: 14 }}>Get Your Free Evaluation</Link>
          </div>
        </div>
      </section>

      {/* ===== FAQ ===== */}
      <section id="faq" className="landing-faq">
        <div className="landing-container">
          <div className="lp-kicker lp-kicker-solo">FAQ</div>
          <div className="landing-faq-list" style={{ margin: '20px auto 0' }}>
            {FAQ_ITEMS.map((item, i) => (
              <div
                key={i}
                className={'landing-faq-item ' + (openFaq === i ? 'open' : '')}
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
              >
                <div className="landing-faq-question">
                  <span>{item.q}</span>
                  <svg className="landing-faq-chevron" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
                {openFaq === i && <div className="landing-faq-answer">{item.a}</div>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Closing ===== */}
      <section className="landing-footer-cta">
        <h2 style={{ marginBottom: 12 }}>Stop Doing Someone Else's Workout.</h2>
        <p style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', maxWidth: 600, margin: '0 auto 28px', lineHeight: 1.6 }}>
          AI Programming. AI Year of the Engine. Or both.
        </p>
        <Link to="/auth?signup=1&next=/profile" className="landing-cta">Get Your Free Evaluation</Link>
      </section>

      <footer className="landing-footer">
        <GainsLogo />
        {/* Visible on mobile too — the header nav is display:none under 640px. */}
        <div style={{ marginTop: 10, display: 'flex', gap: 18, justifyContent: 'center' }}>
          <Link to="/examples" style={{ color: 'var(--text-dim)', textDecoration: 'none', fontSize: 13, fontWeight: 500 }}>
            Real Examples
          </Link>
          <Link to="/qa" style={{ color: 'var(--text-dim)', textDecoration: 'none', fontSize: 13, fontWeight: 500 }}>
            Q&amp;A: Ask a Coach
          </Link>
        </div>
      </footer>
    </div>
  );
}
