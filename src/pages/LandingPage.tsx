import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import GainsLogo from '../components/GainsLogo';
import '../landing.css';

/** Inline styled plan name — bold + accent color, used throughout FAQs */
const PN: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <strong style={{ color: 'var(--accent)' }}>{children}</strong>
);

/** Dashed image-placeholder box. Swap each for a real <img> once art is ready. */
// One shared image frame so every landing-page screenshot looks uniform on
// mobile: full-width, natural aspect ratio, rounded, subtle border + shadow,
// lazy-loaded. Pass `src` once the art exists; until then it renders the
// dashed placeholder box (sized by `ratio`) with the same corner radius.
const IMG_FRAME: React.CSSProperties = {
  width: '100%',
  display: 'block',
  borderRadius: 14,
  border: '1px solid var(--border)',
  boxShadow: '0 8px 30px rgba(0,0,0,.25)',
};
const Placeholder: React.FC<{ label: string; src?: string; alt?: string; ratio?: string }> = ({ label, src, alt, ratio = '16 / 10' }) => {
  if (src) {
    return <img src={src} alt={alt ?? ''} loading="lazy" style={IMG_FRAME} />;
  }
  return (
    <div style={{
      width: '100%',
      aspectRatio: ratio,
      border: '2px dashed var(--border)',
      borderRadius: 14,
      background: 'var(--surface)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--text-dim)',
      fontSize: 14,
      textAlign: 'center',
      padding: 24,
      boxSizing: 'border-box',
    }}>
      {label}
    </div>
  );
};

/** Small uppercase accent label that sits above a section headline. */
const Eyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ textTransform: 'uppercase', letterSpacing: '1px', fontSize: 13, fontWeight: 700, color: 'var(--accent)', marginBottom: 12 }}>
    {children}
  </div>
);

const sectionHeadline: React.CSSProperties = { fontSize: 'clamp(26px,3.4vw,34px)', fontWeight: 700, letterSpacing: '-.5px', lineHeight: 1.2, marginBottom: 16 };
const bodyP: React.CSSProperties = { fontSize: 16, lineHeight: 1.7, color: 'var(--text-dim)', marginBottom: 16 };
const featureRow: React.CSSProperties = { display: 'flex', gap: 48, alignItems: 'center', flexWrap: 'wrap' };
const featureCol: React.CSSProperties = { flex: '1 1 360px', minWidth: 280 };
const stepBadge: React.CSSProperties = { flex: '0 0 auto', width: 34, height: 34, borderRadius: '50%', border: '2px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 15 };
const stepTitle: React.CSSProperties = { fontSize: 17, fontWeight: 700, color: 'var(--text)' };

const FAQ_ITEMS: { q: string; a: React.ReactNode }[] = [
  {
    q: 'How can I try it before paying?',
    a: <>Create a <a href="/auth?signup=1" style={{ color: 'var(--accent)', fontWeight: 600 }}>free account</a>, then your evaluation, 3 coach questions, and unlimited past-Open workouts — no card required.</>,
  },
  {
    q: "What's the difference between the plans?",
    a: <><PN>AI Programming</PN> builds and adapts your full training program; <PN>Year of the Engine</PN> is the conditioning program; <PN>All Access</PN> is both.</>,
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes. No contracts or commitments — cancel anytime and keep access through the end of your billing period.',
  },
  {
    q: "What's included with every plan?",
    a: 'Your AI coach, full analytics, and competition rankings.',
  },
  {
    q: 'What is All Access?',
    a: <>Both programs — <PN>AI Programming</PN> and <PN>Year of the Engine</PN> — under one subscription, coach included.</>,
  },
  {
    q: 'I have additional questions. How can I contact you?',
    a: <>You can send us an email anytime to <a href="mailto:coach@thegainslab.com" style={{ color: 'var(--accent)' }}>coach@thegainslab.com</a></>,
  },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [pricingInterval, setPricingInterval] = useState<'monthly' | 'quarterly'>('monthly');
  const goToAuth = () => navigate('/auth');

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
          </nav>
          <button className="landing-signin-btn" onClick={goToAuth}>Sign In</button>
        </div>
      </header>

      {/* ===== Hero ===== */}
      <section className="landing-hero">
        <GainsLogo className="landing-hero-logo" />
        <h1 className="landing-hero-title">Stop Doing Someone Else's Workout.</h1>
        <p className="landing-hero-sub">
          A coach that learns who you are, finds what's holding you back, and adapts as you improve — built on 15 million workout results.
        </p>
        <div className="landing-hero-ctas">
          <Link to="/auth?signup=1" className="landing-cta">Get Your Free Evaluation</Link>
          <a href="#how-it-works" className="landing-cta landing-cta-outline">See How It Works &rarr;</a>
        </div>

        {/* Visual: evaluation screenshot. */}
        <div style={{ width: '100%', maxWidth: 820, margin: '48px auto 0' }}>
          <Placeholder src="/images/hero-eval.png" alt="Your GAINS evaluation" label="[ Image placeholder — Evaluation screenshot (~820×512) ]" />
        </div>

        <p style={{ marginTop: 24, fontSize: 15, color: 'var(--text-dim)', fontWeight: 500 }}>
          <span style={{ color: 'var(--accent)' }}>Free evaluation.</span> No credit card. Five minutes.
        </p>
      </section>

      {/* ===== Data comes to life ===== */}
      <section id="how-it-works" className="landing-explainer" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="landing-container">
          <Eyebrow>Data comes to life</Eyebrow>
          <h2 style={sectionHeadline}>Most Apps Record Your Workout. Your Coach Interprets It.</h2>
          <p style={{ ...bodyP, maxWidth: 680, marginBottom: 36 }}>
            A spreadsheet saves your score. A coach tells you what it means — and what to do about it.
          </p>

          {/* Split screen: a bare logged result vs. the personalized coach read */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20, alignItems: 'start' }}>
            {/* Left — Most Apps: just a logged result, no insight */}
            <div>
              <div style={{ textTransform: 'uppercase', letterSpacing: '1px', fontSize: 15, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 14 }}>
                Most Apps
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '22px 0' }}>
                <span style={{ fontSize: 26, fontWeight: 700, color: 'var(--text-dim)' }}>Fran</span>
                <span style={{ fontSize: 32, fontWeight: 800, color: 'var(--text-dim)' }}>3:42</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 9px' }}>RX</span>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-label="Logged">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
            </div>
            {/* Right — With GAINS: the high-info context card */}
            <div>
              <div style={{ textTransform: 'uppercase', letterSpacing: '1px', fontSize: 15, fontWeight: 700, color: 'var(--accent)', marginBottom: 14 }}>
                With GAINS
              </div>
              <img
                src="/images/fran-data.png"
                alt="Your coach's read on Fran: top 12% power output, gymnastics endurance limiter, aerobic recovery improving — recommendation: increase gymnastics density"
                loading="lazy"
                style={{ width: '100%', display: 'block', borderRadius: 14, border: '2px solid var(--accent)', boxShadow: '0 8px 30px rgba(0,0,0,.25)' }}
              />
            </div>
          </div>

          {/* The Difference — Workout → Context → Insight → Action (repositioned from the pills). */}
          <div style={{ marginTop: 40, maxWidth: 680 }}>
            <div style={{ fontSize: 15, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text)', marginBottom: 16 }}>
              The Difference
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 16, lineHeight: 1.5 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span style={{ fontWeight: 700, color: 'var(--accent)', flex: '0 0 84px' }}>Workout</span>
                <span style={{ color: 'var(--text-muted)' }}>&rarr;</span>
                <span style={{ color: 'var(--text-dim)' }}>Fran 3:42</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span style={{ fontWeight: 700, color: 'var(--accent)', flex: '0 0 84px' }}>Context</span>
                <span style={{ color: 'var(--text-muted)' }}>&rarr;</span>
                <span style={{ color: 'var(--text-dim)' }}>97th percentile &middot; <span style={{ color: 'var(--accent)', fontWeight: 600 }}>3.70 W/kg</span></span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span style={{ fontWeight: 700, color: 'var(--accent)', flex: '0 0 84px' }}>Insight</span>
                <span style={{ color: 'var(--text-muted)' }}>&rarr;</span>
                <span style={{ color: 'var(--text-dim)' }}>Elite power, but the thruster lean is leaking some of it</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span style={{ fontWeight: 700, color: 'var(--accent)', flex: '0 0 84px' }}>Action</span>
                <span style={{ color: 'var(--text-muted)' }}>&rarr;</span>
                <span style={{ color: 'var(--text-dim)' }}>Thruster hip drive practice</span>
              </div>
            </div>
            <p style={{ ...bodyP, marginTop: 20, marginBottom: 0 }}>
              A score isn't just a job well done, a benchmark, or another number on a list. It's actionable information — and a point on the continuum toward your goal.
            </p>
          </div>
        </div>
      </section>

      {/* ===== How It Knows You ===== */}
      <section className="landing-explainer" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="landing-container">
          <Eyebrow>How It Knows You</Eyebrow>
          <h2 style={sectionHeadline}>A personalized program starts with a person.</h2>
          <p style={{ ...bodyP, maxWidth: 720 }}>
            Before it programs anything, the coach learns you — strength, conditioning, gymnastics, movement limitations, goals. That picture is your evaluation, and it's the foundation of everything that follows.
          </p>

          {/* Numbered path: build profile → add history → get evaluation (the destination). */}
          <div style={{ maxWidth: 640, marginTop: 28 }}>
            {/* ① Build your profile */}
            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={stepBadge}>1</div>
                <div style={{ flex: 1, width: 2, background: 'var(--accent)', minHeight: 16 }} />
              </div>
              <div style={{ paddingBottom: 28 }}>
                <div style={stepTitle}>Build your profile <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>— about five minutes.</span></div>
                <p style={{ ...bodyP, marginTop: 4, marginBottom: 0 }}>Strength numbers, key ratios, skills, benchmarks, goals.</p>
              </div>
            </div>
            {/* ② Add as much history as you want */}
            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={stepBadge}>2</div>
                <div style={{ flex: 1, width: 2, background: 'var(--accent)', minHeight: 16 }} />
              </div>
              <div style={{ paddingBottom: 28 }}>
                <div style={stepTitle}>Add as much history as you want.</div>
                <p style={{ ...bodyP, marginTop: 4, marginBottom: 0 }}>Competed before? Link your seasons and your coach analyzes your entire career in seconds — nothing like it exists anywhere. Never competed? Doesn't matter — your profile gives your coach everything it needs.</p>
              </div>
            </div>
            {/* ③ Get your evaluation — the destination */}
            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ ...stepBadge, background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' }}>3</div>
              </div>
              <div>
                <div style={stepTitle}>Get your evaluation <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>— your strengths, your weaknesses, where you rank.</span></div>
                <p style={{ ...bodyP, marginTop: 4, marginBottom: 0 }}>Then explore the rest of your free account: your full athlete data dashboard, any past open workout to test yourself on, your first coach questions.</p>
              </div>
            </div>
          </div>

          {/* The evaluation itself */}
          <div style={{ maxWidth: 920, margin: '36px auto 0' }}>
            <Placeholder src="/images/section2-eval.png" alt="A full GAINS fitness evaluation" label="[ Image placeholder — Full evaluation screenshot ]" />
            <p style={{ textAlign: 'center', fontSize: 17, fontWeight: 600, color: 'var(--text)', lineHeight: 1.6, margin: '20px auto 0' }}>
              Your evaluation identifies your gaps. Your program fixes them.
            </p>
            <div style={{ textAlign: 'center', marginTop: 24 }}>
              <Link to="/auth?signup=1" className="landing-cta">Get Your Free Evaluation</Link>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 14, marginBottom: 0 }}>No credit card required</p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== What the Data Does for You ===== */}
      <section className="landing-explainer" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="landing-container" style={featureRow}>
          <div style={featureCol}>
            <Eyebrow>What the Data Does for You</Eyebrow>
            <h2 style={sectionHeadline}>What 15 Million Competition Results Do for You.</h2>
            <p style={{ ...bodyP, marginBottom: 16 }}>
              Every season of the worldwide online open. Every quarterfinal. Every championship leaderboard in the sport's history. Your coach has studied all of it — and that's what makes it precise.
            </p>
            <p style={{ ...bodyP, marginBottom: 4, fontWeight: 600, color: 'var(--text)' }}>Stop guessing about your weaknesses.</p>
            <p style={bodyP}>
              “I'm bad at long workouts” becomes “your average power drops 31% past the ten-minute mark.” Your coach doesn't deal in feelings — it measures the exact gap between you and the athletes ranked above you, then your program attacks it first, because closing it moves you up the most.
            </p>
            <p style={{ ...bodyP, marginBottom: 4, fontWeight: 600, color: 'var(--text)' }}>Stop guessing about your progress.</p>
            <p style={{ ...bodyP, marginBottom: 0 }}>
              The sport has never been able to turn scores into fitness. You do well on a seven-minute workout and worse on a ten — was it the barbell? The gymnastics? The engine? Until now, nobody could say. Your coach can: it converts every result into one measurement — watts per kilogram — and reads it across every dimension that matters: time domain, modality, load. Measured against the sport's entire competitive history, across more parameters than any platform anywhere. You don't have to wait six months to repeat a benchmark to know it's working. You can watch yourself climb.
            </p>
          </div>
          <div style={featureCol}>
            <Placeholder src="/images/power-duration-curve.png" alt="Power-duration curve — your watts per kilogram across every time domain" label="[ Image placeholder — Power-duration curve + percentile / ranking view ]" />
          </div>
        </div>
      </section>

      {/* ===== Your Coach, Every Training Day ===== */}
      <section className="landing-explainer" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="landing-container" style={{ maxWidth: 760 }}>
          <Eyebrow>Your Coach, Every Training Day</Eyebrow>
          <h2 style={sectionHeadline}>A complete day, built around you.</h2>
          <p style={bodyP}>
            Every session arrives whole — warm-up to cooldown. Skills progressions, strength at your percentages, conditioning paced to your engine. The loads are computed from your numbers, the structure from your gaps. Nothing generic. Nothing guessed.
          </p>
          {/* Single training day — illustrates the bullets above. */}
          <div style={{ margin: '8px 0 28px' }}>
            <Placeholder src="/images/Single-Day.png" alt="A single training day — warm-up, skills, strength, accessory, metcon, and cool-down" label="[ Image placeholder — Single day ]" />
          </div>
          <p style={{ ...bodyP, marginBottom: 0 }}>
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>Why this workout? How should I pace it? What if my shoulder's cranky today?</span> The coach answers from your data — your profile, your history, today's session — so every answer is about you, not generic internet advice.
          </p>
          {/* Coach-chat screen (rowing-pacing example). */}
          <div style={{ marginTop: 20 }}>
            <Placeholder src="/images/strong-rower.png" alt="The AI coach answering a pacing question in the context of your workout" label="[ Image placeholder — Coach chat (rowing-pacing example) ]" />
          </div>
          <p style={{ ...bodyP, marginTop: 28, marginBottom: 0 }}>
            This is just the start. AI editing on every block, a coach in your pocket, and a learning model that sharpens with every score you log — built to improve your fitness faster than anything else out there.
          </p>
          <div style={{ marginTop: 20 }}>
            <Link to="/features/programs" className="landing-cta">Explore AI Programming →</Link>
          </div>
        </div>
      </section>

      {/* ===== It Learns From Every Workout ===== */}
      <section className="landing-explainer" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="landing-container">
          <Eyebrow>It Learns From Every Workout</Eyebrow>
          <h2 style={{ ...sectionHeadline, textAlign: 'center', marginBottom: 28 }}>Your Coach Learns From Every Workout.</h2>
          <p style={{ ...bodyP, maxWidth: 760, margin: '0 auto 16px', textAlign: 'center' }}>
            Every score, RPE, and quality rating you log teaches the coach about you — and everything it builds for you gets sharper.
          </p>
          <p style={{ ...bodyP, maxWidth: 760, margin: '0 auto 8px', textAlign: 'center' }}>
            <strong>AI Programming:</strong> log RPE 9 and miss reps → next week backs off the load.
          </p>
          <p style={{ ...bodyP, maxWidth: 760, margin: '0 auto 28px', textAlign: 'center' }}>
            <strong>Year of the Engine — our dedicated conditioning program:</strong> post a faster 2K → every interval re-paces to your new fitness.
          </p>
          <p style={{ ...bodyP, maxWidth: 760, margin: '0 auto', textAlign: 'center' }}>
            It knows when to push — and when pushing is the wrong call. Your plan isn't fixed. It's a working model of you, adjusting to how you respond.
          </p>
        </div>
      </section>

      {/* ===== Plans ===== */}
      <section className="landing-explainer" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="landing-container" style={{ maxWidth: 720 }}>
          <h2 style={{ ...sectionHeadline, textAlign: 'center' }}>Let's Make Some Gains.</h2>
          <p style={{ ...bodyP, textAlign: 'center', maxWidth: 600, margin: '0 auto 28px' }}>
            Two programs, one bundle — and the coach comes with all of them.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 16, margin: '0 0 24px' }}>
            <Link to="/features/programs" className="landing-offering-card" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
              <h3>AI Programming &rarr;</h3>
              <p>Your program, built and adapted around you, with coaching guidance on every exercise.</p>
            </Link>
            <Link to="/features/engine" className="landing-offering-card" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
              <h3>Year of the Engine &rarr;</h3>
              <p>Conditioning calibrated to you, every interval paced to your fitness.</p>
            </Link>
            <Link to="/features/nutrition" className="landing-offering-card" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
              <h3>AI Nutrition &rarr;</h3>
              <p>Fuel built for how you train, with targets set to your training and calorie burn from your real output.</p>
            </Link>
          </div>
          <p style={{ ...bodyP, marginBottom: 16 }}>
            Individualized coaching typically runs $100–300 a month. Big-name templates charge $30–60 for the same workout sent to everyone. <span style={{ fontWeight: 600, color: 'var(--text)' }}>GAINS builds yours — for less than either.</span>
          </p>
          <p style={{ ...bodyP, marginBottom: 8 }}>Every plan includes your AI coach, full analytics, competition rankings, and a complete nutrition app. No add-ons.</p>
          <p style={{ ...bodyP, marginBottom: 0 }}>
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>Not ready to pick?</span> Start free: your evaluation, your athlete dashboard, three coach questions, unlimited past open workouts. Pick a plan when you're ready.
          </p>
        </div>
      </section>

      {/* ===== Pricing ===== */}
      <section id="pricing" className="landing-pricing">
        <div className="landing-container">
          <div className="landing-pricing-table">
            <div style={{ display: 'flex', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
              <button
                style={{ flex: 1, padding: '10px 0', border: 'none', fontFamily: "'Outfit', sans-serif", fontSize: 14, fontWeight: 600, cursor: 'pointer', background: pricingInterval === 'monthly' ? 'var(--accent)' : 'transparent', color: pricingInterval === 'monthly' ? 'white' : 'var(--text-dim)', transition: 'all .15s' }}
                onClick={() => setPricingInterval('monthly')}
              >
                Monthly
              </button>
              <button
                style={{ flex: 1, padding: '10px 0', border: 'none', fontFamily: "'Outfit', sans-serif", fontSize: 14, fontWeight: 600, cursor: 'pointer', background: pricingInterval === 'quarterly' ? 'var(--accent)' : 'transparent', color: pricingInterval === 'quarterly' ? 'white' : 'var(--text-dim)', transition: 'all .15s' }}
                onClick={() => setPricingInterval('quarterly')}
              >
                Quarterly
              </button>
            </div>
            <div className="landing-pricing-header">
              <span>Service</span>
              <span>{pricingInterval === 'monthly' ? 'Monthly' : 'Quarterly'}</span>
            </div>
            {[
              { plan: 'programming', name: 'AI Programming', monthly: '$29.99', quarterly: '$74.99' },
              { plan: 'engine', name: 'Year of the Engine', monthly: '$29.99', quarterly: '$74.99' },
              { plan: 'all_access', name: 'All Access', monthly: '$49.99', quarterly: '$119.99', note: '(AI Programming and Year of the Engine)' },
            ].map(p => (
              <div
                key={p.plan}
                className="landing-pricing-row"
              >
                <div>
                  <span className="landing-pricing-name">{p.name}</span>
                  {p.note && <div className="landing-pricing-note">{p.note}</div>}
                </div>
                <span className="landing-pricing-amount">
                  {pricingInterval === 'monthly' ? p.monthly : p.quarterly}
                </span>
              </div>
            ))}


          </div>
        </div>
      </section>

      {/* ===== FAQ ===== */}
      <section id="faq" className="landing-faq">
        <div className="landing-container">
          <h2 className="landing-section-title">Frequently Asked Questions</h2>
          <div className="landing-faq-list">
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

      {/* ===== Final CTA ===== */}
      <section className="landing-footer-cta">
        <h2>Stop Doing Someone Else's Workout.</h2>
        <p style={{ fontSize: 17, color: 'var(--text-dim)', maxWidth: 600, margin: '0 auto 28px', lineHeight: 1.6 }}>
          Meet the coach that learns who you are, measures what matters, and adapts as you improve.
        </p>
        <Link to="/auth?signup=1" className="landing-cta">Get Your Free Evaluation</Link>
      </section>

      <footer className="landing-footer">
        <GainsLogo />
      </footer>
    </div>
  );
}
