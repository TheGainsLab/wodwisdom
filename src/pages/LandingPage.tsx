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

        <p style={{ marginTop: 24, fontSize: 14, color: 'var(--text-dim)', fontWeight: 500 }}>
          Always available. Never forgets.
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
          </div>
        </div>
      </section>

      {/* ===== How It Knows You ===== */}
      <section className="landing-explainer" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="landing-container">
          <Eyebrow>How It Knows You</Eyebrow>
          <h2 style={sectionHeadline}>Get Your Free Evaluation.</h2>
          <p style={{ ...bodyP, maxWidth: 720 }}>
            Before it programs anything, the coach builds a complete picture of you — strength, conditioning, gymnastics, competition performance, and movement limitations. That picture is your evaluation, and it's the foundation of everything that follows.
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
            {/* ② Add your history */}
            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={stepBadge}>2</div>
                <div style={{ flex: 1, width: 2, background: 'var(--accent)', minHeight: 16 }} />
              </div>
              <div style={{ paddingBottom: 28 }}>
                <div style={stepTitle}>Add your history <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>— have you done the CrossFit Open?</span></div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 14 }}>
                  <div>
                    <Link to="/auth?signup=1&path=link" className="landing-cta" style={{ display: 'inline-block', padding: '10px 20px', fontSize: 14 }}>Yes — link my history</Link>
                    <p style={{ ...bodyP, fontSize: 14, marginTop: 6, marginBottom: 0 }}>Link your Opens and get your entire competitive career analyzed in seconds.</p>
                  </div>
                  <div>
                    <Link to="/auth?signup=1&path=benchmark" className="landing-cta landing-cta-outline" style={{ display: 'inline-block', padding: '10px 20px', fontSize: 14 }}>No — see how you'd stack up</Link>
                    <p style={{ ...bodyP, fontSize: 14, marginTop: 6, marginBottom: 0 }}>Complete a few past Open workouts and we'll build your baseline.</p>
                  </div>
                </div>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 14, marginBottom: 0 }}>Free account — takes a minute. Then you're in.</p>
              </div>
            </div>
            {/* ③ Get your evaluation — the destination */}
            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ ...stepBadge, background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' }}>3</div>
              </div>
              <div style={{ alignSelf: 'center' }}>
                <div style={stepTitle}>Get your evaluation <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>— your strengths, your weaknesses, where you rank.</span></div>
              </div>
            </div>
          </div>

          {/* The evaluation itself */}
          <div style={{ maxWidth: 920, margin: '36px auto 0' }}>
            <Placeholder src="/images/section2-eval.png" alt="A full GAINS fitness evaluation" label="[ Image placeholder — Full evaluation screenshot ]" />
            <p style={{ textAlign: 'center', fontSize: 17, fontWeight: 600, color: 'var(--text)', lineHeight: 1.6, margin: '20px auto 0' }}>
              Your evaluation identifies your gaps. Your program fixes them.
            </p>
          </div>
        </div>
      </section>

      {/* ===== A Common Language for Fitness ===== */}
      <section className="landing-explainer" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="landing-container" style={featureRow}>
          <div style={featureCol}>
            <Eyebrow>A Common Language for Fitness</Eyebrow>
            <h2 style={sectionHeadline}>Fitness Needs a Common Language.</h2>
            <p style={bodyP}>
              A rowing workout doesn't look like a lifting workout. A two-minute sprint doesn't look like a twenty-minute grinder. The coach converts every result into watts and watts per kilogram — one scale for every workout you do.
            </p>
            <p style={{ ...bodyP, marginBottom: 12, fontWeight: 600, color: 'var(--text)' }}>That unlocks two things you couldn't see before:</p>
            <p style={bodyP}>
              <span style={{ fontWeight: 600, color: 'var(--text)' }}>Progress over time.</span> Because everything's on one scale, you can finally tell what's improving and what's stalling — across every time domain, not just the workouts you happen to repeat.
            </p>
            <p style={{ ...bodyP, marginBottom: 0 }}>
              <span style={{ fontWeight: 600, color: 'var(--text)' }}>Where you stand.</span> Your numbers are ranked against 15 million workouts, plus Open, Quarterfinal, and competition data — so you know exactly where you sit, and how far you are from the top 1%.
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
          <h2 style={sectionHeadline}>Every Workout Has a Purpose.</h2>
          <p style={bodyP}>The coach doesn't just tell you what to do. For each session it explains:</p>
          <ul style={{ margin: '0 0 16px', paddingLeft: 18, fontSize: 16, lineHeight: 1.8, color: 'var(--text-dim)' }}>
            <li>Why today's workout exists</li>
            <li>What adaptation you're chasing</li>
            <li>What success looks like</li>
            <li>How it fits into your goals</li>
          </ul>
          {/* Training-intent screen — illustrates the bullets above. */}
          <div style={{ margin: '8px 0 28px' }}>
            <Placeholder src="/images/training-intent.png" alt="A training day with its intent: why it exists, the adaptation, and what success looks like" label="[ Image placeholder — Training-intent screen ]" />
          </div>
          <p style={{ ...bodyP, marginBottom: 0 }}>
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>Ask the Coach:</span> And when you have a question, the coach answers in context. It sees your profile, your history, today's workout, and your strengths and weaknesses — so the answer is specific to you, not generic internet advice. Your first three questions are free.
          </p>
          {/* Coach-chat screen (rowing-pacing example). */}
          <div style={{ marginTop: 20 }}>
            <Placeholder src="/images/AI-coach.png" alt="The AI coach answering a pacing question in the context of your workout" label="[ Image placeholder — Coach chat (rowing-pacing example) ]" />
          </div>
        </div>
      </section>

      {/* ===== It Learns From Every Workout ===== */}
      <section className="landing-explainer" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="landing-container">
          <Eyebrow>It Learns From Every Workout</Eyebrow>
          <h2 style={{ ...sectionHeadline, textAlign: 'center', marginBottom: 28 }}>Your Coach Learns From Every Workout.</h2>
          <p style={{ ...bodyP, maxWidth: 760, margin: '0 auto 16px', textAlign: 'center' }}>
            Most programs stay fixed. Yours adapts. Every workout, every score, every RPE, every quality rating sharpens the next decision — so the coach gets sharper every time you train.
          </p>
          <p style={{ ...bodyP, maxWidth: 760, margin: '0 auto 28px', textAlign: 'center' }}>
            Over time it even learns to calibrate you: how your reported effort and quality line up with your actual output, so its read on you keeps getting more accurate. Your program isn't a fixed plan — it's a working model that adjusts to how you respond.
          </p>
          <div style={{ maxWidth: 760, margin: '0 auto' }}>
            {/* TODO: replace with the adaptation-cycle diagram */}
            <Placeholder label="[ Image placeholder — Adaptation cycle diagram ]" ratio="16 / 9" />
          </div>
        </div>
      </section>

      {/* ===== Plans ===== */}
      <section className="landing-explainer" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="landing-container" style={{ maxWidth: 720 }}>
          <h2 style={{ ...sectionHeadline, textAlign: 'center' }}>Let's Make Some Gains.</h2>
          <p style={{ ...bodyP, textAlign: 'center', maxWidth: 600, margin: '0 auto 28px' }}>
            Two programs, one bundle. The AI coach, analytics, and competition rankings come with all of them.
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
            <Link to="/auth?signup=1" className="landing-offering-card" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
              <h3>All Access &rarr;</h3>
              <p>Both programs together.</p>
            </Link>
          </div>
          <p style={{ ...bodyP, marginBottom: 8 }}>Every plan includes your AI coach, full analytics, and competition rankings. No add-ons.</p>
          <p style={{ ...bodyP, marginBottom: 0 }}>
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>Free — start here:</span> 1 evaluation, 3 coach questions, unlimited past-Open workouts. Then pick a plan.
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
