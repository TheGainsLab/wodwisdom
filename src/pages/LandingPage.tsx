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
// Matches the site-wide uploaded-screenshot treatment (.feature-img):
// a crisp 1px white border + 16px radius, so landing images read the same as
// the feature pages. Shadow kept for a touch of depth.
const IMG_FRAME: React.CSSProperties = {
  width: '100%',
  display: 'block',
  borderRadius: 16,
  border: '1px solid #ffffff',
  background: 'var(--bg)',
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
// Real-HTML coach chat (replaces a screenshot) — crisp, responsive, readable.
function CoachChat() {
  return (
    <div style={{ ...IMG_FRAME, background: 'var(--surface)', padding: '20px 20px 24px', maxWidth: 720, margin: '0 auto' }}>
      <div style={{ textTransform: 'uppercase', letterSpacing: '1px', fontSize: 13, fontWeight: 700, color: 'var(--accent)', marginBottom: 18 }}>AI Coach</div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <div style={{ background: 'var(--accent)', color: '#fff', padding: '12px 16px', borderRadius: '16px 16px 4px 16px', maxWidth: '88%', fontSize: 16, fontWeight: 600, lineHeight: 1.5 }}>
          I'm a strong rower — how should that influence my pacing?
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
        <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text-dim)', padding: '16px 18px', borderRadius: '16px 16px 16px 4px', maxWidth: '92%', fontSize: 16, lineHeight: 1.65 }}>
          <p style={{ margin: '0 0 12px' }}>Looking at your numbers, you're genuinely strong on the erg. A 2:59 1k and 6:20 2k put you well above average, and your competition data backs that up — rowing shows up as one of your better monostructural movements, averaging around the 90th percentile in Open events. That's a real asset, but it also creates a specific pacing trap worth knowing about.</p>
          <p style={{ margin: 0 }}>Strong rowers tend to go out too hot on the row calories in a couplet like today's metcon because the calories feel easy relative to their capacity. The problem is that 16 calories at a hard pace will spike your heart rate and blow up your legs for the thrusters, even at 95 lbs. At your strength level, 95 lbs is essentially unloaded — your thruster 1RM is well north of 200 lbs — so the thrusters should never be the limiting factor. Don't let aggressive rowing make them one.</p>
        </div>
      </div>
    </div>
  );
}

// Real-HTML "With GAINS" read on Fran (replaces a screenshot).
function FranReadCard() {
  const metric = (label: string, value: string) => (
    <div>
      <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 700, color: 'var(--text)', fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
    </div>
  );
  const divider = <div style={{ height: 1, background: 'var(--border)', margin: '16px 0' }} />;
  return (
    <div style={{ ...IMG_FRAME, background: 'var(--surface)', padding: '20px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 18 }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Tue, Jun 9</span>
        <span style={{ fontSize: 15, color: 'var(--text-muted)' }}>Metcon · Rx</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 16 }}>
        {metric('Power', '3.70 W/kg')}
        {metric('Score', '3:42')}
        {metric('Time domain', 'medium')}
        {metric('Percentile', '97th')}
      </div>
      {divider}
      <div style={{ fontSize: 16, color: 'var(--text-dim)', lineHeight: 1.6 }}>
        <div style={{ fontWeight: 600, color: 'var(--text)' }}>Short sprint couplet</div>
        <div>Thruster — 21-15-9 reps · 95 lbs</div>
        <div>Pull-ups — 21-15-9 reps</div>
      </div>
      {divider}
      <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--text-muted)', marginBottom: 6 }}>Faults observed</div>
      <div style={{ fontSize: 16, lineHeight: 1.55, color: 'var(--text-dim)' }}>
        <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Thruster:</span> Forward lean in squat causing bar to drift away from body
      </div>
      <div style={{ fontSize: 16, fontStyle: 'italic', color: 'var(--text-dim)', marginTop: 14 }}>New Fran PR!</div>
    </div>
  );
}

// Real-HTML training-intent card (replaces a screenshot).
function TrainingIntentCard() {
  return (
    <div style={{ ...IMG_FRAME, background: 'var(--surface)', padding: '20px 22px' }}>
      <div style={{ textTransform: 'uppercase', letterSpacing: '1px', fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 16 }}>Week 1 · Day 1</div>
      <div style={{ border: '1px solid var(--border)', borderRadius: 14, background: 'var(--bg)', padding: '20px 22px' }}>
        <div style={{ textTransform: 'uppercase', letterSpacing: '1px', fontSize: 14, fontWeight: 700, color: 'var(--accent)', marginBottom: 12 }}>Training Intent</div>
        <p style={{ fontSize: 18, lineHeight: 1.7, color: 'var(--text-dim)', margin: 0 }}>
          This session builds pulling strength through heavy deadlift work while developing midline stability via GHD sit-up progressions practiced early when the nervous system is fresh for optimal motor learning. The short power couplet tests metabolic power and movement efficiency under fatigue, with thrusters challenging the hip hinge pattern established in deadlifts while rowing provides a different pulling pattern that complements but doesn't interfere with the strength work.
        </p>
      </div>
    </div>
  );
}

// Real-HTML metcon history (replaces a screenshot) — the logged training that
// feeds the coach. Each row: date · score · Rx, W/kg, then the workout.
function MetconHistory() {
  const entries = [
    { date: 'Tue, Jun 9', score: '3:42', wkg: '3.70', title: 'Short sprint couplet', moves: ['Thruster — 21-15-9 reps · 95 lbs', 'Pull-ups — 21-15-9 reps'] },
    { date: 'Sun, Jun 7', score: '4+13', wkg: '2.01', title: 'Medium mixed modal', moves: ['Wall Ball — 20 reps · 20 lbs (to 10-foot target)', 'Double Under — 30 reps', 'Clean — 10 reps · 155 lbs'] },
    { date: 'Fri, May 22', score: '17:45', wkg: '2.73', title: 'Long Steady Pace', moves: ['Row — 2000 m', 'Push Up — 50 reps', 'Air Squat — 100 reps', 'Wall Ball — 150 reps · 20 lbs'] },
    { date: 'Fri, May 22', score: '6:15', wkg: '2.35', title: 'Short Couplet', moves: ['Thruster — 21 reps · 115 lbs', 'Pull Up — 21 reps', 'Thruster — 15 reps · 115 lbs', 'Pull Up — 15 reps', 'Thruster — 9 reps · 115 lbs', 'Pull Up — 9 reps'] },
    { date: 'Fri, May 22', score: '10+9', wkg: '2.04', title: 'Mixed conditioning', moves: ['Thruster — 8 reps · 95 lbs', 'Chest To Bar — 10 reps'] },
  ];
  return (
    <div style={{ ...IMG_FRAME, background: 'var(--surface)', padding: 6 }}>
      {entries.map((e, i) => (
        <div key={i} style={{ padding: '14px 16px', borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
            <div style={{ fontSize: 15, color: 'var(--text)' }}>
              <span style={{ fontWeight: 700 }}>{e.date}</span>
              <span style={{ color: 'var(--text-muted)' }}> · Metcon · {e.score}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 4, padding: '1px 6px', marginLeft: 8 }}>Rx</span>
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent)', fontFamily: "'JetBrains Mono', monospace", whiteSpace: 'nowrap' }}>{e.wkg} W/kg</div>
          </div>
          <div style={{ fontSize: 15, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.5 }}>
            <div style={{ fontWeight: 600, color: 'var(--text)' }}>{e.title}</div>
            {e.moves.map((m, j) => <div key={j}>{m}</div>)}
          </div>
        </div>
      ))}
    </div>
  );
}

const Eyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ textTransform: 'uppercase', letterSpacing: '1px', fontSize: 14, fontWeight: 700, color: 'var(--accent)', marginBottom: 12 }}>
    {children}
  </div>
);

const sectionHeadline: React.CSSProperties = { fontSize: 'clamp(26px,3.4vw,34px)', fontWeight: 700, letterSpacing: '-.5px', lineHeight: 1.2, marginBottom: 16 };
const bodyP: React.CSSProperties = { fontSize: 18, lineHeight: 1.7, color: 'var(--text-dim)', marginBottom: 16 };
const stepBadge: React.CSSProperties = { flex: '0 0 auto', width: 34, height: 34, borderRadius: '50%', border: '2px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 15 };
const stepTitle: React.CSSProperties = { fontSize: 19, fontWeight: 700, color: 'var(--text)' };

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
          A coach that learns who you are, finds what's holding you back, and adapts as you improve — backed by insights from the largest performance dataset in fitness.
        </p>
        <div className="landing-hero-ctas">
          <Link to="/auth?signup=1" className="landing-cta">Get Your Free Evaluation</Link>
          <a href="#how-it-works" className="landing-cta landing-cta-outline">See How It Works &rarr;</a>
        </div>

        {/* Framer: introduce the evaluation as proof + what every athlete gets.
            Keeps the hero in its "proof it's real" lane; the full how-it-works
            (build profile → add history → get evaluation) lives in section 3. */}
        <div style={{ maxWidth: 640, margin: '48px auto 0', textAlign: 'center' }}>
          <Eyebrow>Personal from day one</Eyebrow>
          <p style={{ fontSize: 18, lineHeight: 1.7, color: 'var(--text-dim)', margin: 0 }}>
            Most programs are one-size-fits-all — the same plan for everyone, built without knowing a thing about you. GAINS gets to know you first: your ability, your history, your limiters, and exactly what to do about them. Here's an excerpt from a real athlete's evaluation:
          </p>
        </div>

        {/* Visual: a real athlete's evaluation (excerpt of a multi-page eval). */}
        <div style={{ width: '100%', maxWidth: 820, margin: '20px auto 0' }}>
          <Placeholder src="/images/hero-eval.png" alt="A real GAINS athlete evaluation" label="[ Image placeholder — Evaluation screenshot (~820×512) ]" />
        </div>

        <p style={{ ...bodyP, marginTop: 18 }}>
          What you see here is a preview. Your full evaluation is a complete map — your strengths, your hidden bottlenecks, and exactly what to prioritize next. We measure your results against <span style={{ color: 'var(--accent)' }}>15 million</span> real competition scores, so every number in your evaluation actually means something. You see how good your numbers really are, and exactly where you stand.
        </p>
      </section>

      {/* ===== How It Knows You ===== */}
      <section id="how-it-works" className="landing-explainer" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="landing-container">
          <Eyebrow>How It Knows You</Eyebrow>
          <h2 style={sectionHeadline}>Get Your Free Evaluation.</h2>
          <p style={{ ...bodyP, maxWidth: 720 }}>
            Before we write a single rep of programming, your coach builds a complete picture of you — strength, conditioning, gymnastics, movement, and competition performance. That becomes your Evaluation: a comprehensive and candid assessment of where you stand today.
          </p>
          <p style={{ ...bodyP, maxWidth: 720 }}>
            There is no obligation. If you train with us, it becomes the foundation of your personalized program. If not, it's yours to keep, completely free.
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
                <div style={stepTitle}>Tell us about you <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>— in about five minutes.</span></div>
                <p style={{ ...bodyP, marginTop: 8, marginBottom: 0 }}>Strength numbers, key ratios, skills, benchmarks, and goals. This is the foundation of your evaluation.</p>
              </div>
            </div>
            {/* ② Add your history */}
            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={stepBadge}>2</div>
                <div style={{ flex: 1, width: 2, background: 'var(--accent)', minHeight: 16 }} />
              </div>
              <div style={{ paddingBottom: 28 }}>
                <div style={stepTitle}>Link your competition history <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional, but powerful).</span></div>
                <p style={{ ...bodyP, marginTop: 8, marginBottom: 0 }}>
                  Done the Open? Quarterfinals? Regionals? Connect your history in seconds and we'll benchmark you against athletes at every level. No history? No problem — your profile is all we need.
                </p>
              </div>
            </div>
            {/* ③ Get your evaluation — the destination */}
            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ ...stepBadge, background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' }}>3</div>
              </div>
              <div>
                <div style={stepTitle}>Get your complete evaluation.</div>
                <p style={{ ...bodyP, marginTop: 8, marginBottom: 0 }}>
                  Your strengths, your hidden bottlenecks, and exactly where you rank against 15 million athletes. Delivered instantly.
                </p>
              </div>
            </div>
          </div>

          {/* The evaluation itself */}
          <div style={{ maxWidth: 920, margin: '36px auto 0' }}>
            <Placeholder src="/images/section2-eval.png" alt="A full GAINS fitness evaluation" label="[ Image placeholder — Full evaluation screenshot ]" />
            <p style={{ textAlign: 'center', fontSize: 18, fontWeight: 700, color: 'var(--text)', lineHeight: 1.5, margin: '20px auto 0' }}>
              And that's just the beginning.
            </p>
            <p style={{ ...bodyP, textAlign: 'center', maxWidth: 640, margin: '8px auto 0' }}>
              Your free account unlocks the entire GAINS workout history — every Open, every Quarterfinal, every Regionals workout from years past. Test yourself against levels you never reached. Compare your progress to where you were years ago. All free, all yours.
            </p>
            <div style={{ textAlign: 'center', marginTop: 24 }}>
              <Link to="/auth?signup=1" className="landing-cta">Get Your Free Evaluation</Link>
            </div>
          </div>
        </div>
      </section>

      {/* ===== Data comes to life ===== */}
      <section className="landing-explainer" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="landing-container">
          <Eyebrow>Data comes to life</Eyebrow>
          <h2 style={sectionHeadline}>Most Apps Save a Number. We Capture the Whole Picture.</h2>
          <p style={{ ...bodyP, maxWidth: 680, marginBottom: 36 }}>
            Take Fran, for example. Most apps log &ldquo;3:42 RX&rdquo; and move on. GAINS gives you your coach's full read: power output, percentile, time domain, movement quality, and even faults flagged — all on one scale.
          </p>

          {/* Bare logged result, then the personalized coach read — stacked (mobile-first, single column) */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 28, alignItems: 'start', maxWidth: 560 }}>
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
              <FranReadCard />
              <p style={{ fontSize: 15, color: 'var(--text-muted)', marginTop: 10, marginBottom: 0 }}>
                That 97th percentile is measured against 15 million workout results.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== A Common Language for Fitness ===== */}
      <section className="landing-explainer" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="landing-container" style={{ maxWidth: 760 }}>
          <Eyebrow>A Common Language for Fitness</Eyebrow>
          <h2 style={sectionHeadline}>Fitness Needs a Common Language.</h2>
          <p style={bodyP}>
            A rowing workout doesn't look like a lifting workout. A two-minute sprint doesn't look like a twenty-minute grinder. The coach converts every result into watts and watts per kilogram — one scale for every workout you do.
          </p>
          <p style={{ ...bodyP, fontWeight: 600, color: 'var(--text)', marginBottom: 0 }}>That unlocks a single view of your entire training.</p>

          <div style={{ margin: '24px 0' }}>
            <Placeholder src="/images/power-duration-curve.png" alt="Your power across every metcon, your average output, and your power-duration curve across short, medium, and long time domains" label="[ Image placeholder — Power charts ]" />
          </div>

          <p style={bodyP}>
            Your power across every metcon you've completed. Your average output. And your power-duration curve — how your watts per kilogram change across short, medium, and long time domains. All on one scale.
          </p>
          <p style={{ ...bodyP, marginBottom: 12, fontWeight: 600, color: 'var(--text)' }}>That unlocks two things you couldn't see before:</p>
          <p style={bodyP}>
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>Progress over time.</span> Because everything's on one scale, you can finally tell what's improving and what's stalling — across every time domain, not just the workouts you happen to repeat.
          </p>
          <p style={bodyP}>
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>Where you stand.</span> Your numbers are ranked against 15 million workouts, plus Open, Quarterfinal, and competition data — so you know exactly where you sit, and how far you are from the top 1%.
          </p>
          <p style={{ ...bodyP, marginBottom: 0 }}>
            Every percentile and ranking you see is measured against this dataset — the largest in fitness. It's what makes &ldquo;97th percentile&rdquo; mean something. And no other app has it.
          </p>
        </div>
      </section>

      {/* ===== Your Coach, Every Training Day ===== */}
      <section className="landing-explainer" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="landing-container" style={{ maxWidth: 760 }}>
          <Eyebrow>Your Coach, Every Training Day</Eyebrow>
          <h2 style={sectionHeadline}>Every Workout Has a Purpose.</h2>
          <p style={bodyP}>The coach doesn't just tell you what to do. For each session it explains:</p>
          <ul style={{ margin: '0 0 16px', paddingLeft: 18, fontSize: 18, lineHeight: 1.8, color: 'var(--text-dim)' }}>
            <li>Why today's workout exists</li>
            <li>What adaptation you're chasing</li>
            <li>What success looks like</li>
            <li>How it fits into your goals</li>
          </ul>
          <p style={{ ...bodyP, fontWeight: 600, color: 'var(--text)' }}>Before you move a single rep, the coach tells you why.</p>
          {/* Training-intent card — illustrates the bullets above. */}
          <div style={{ margin: '8px 0 28px' }}>
            <TrainingIntentCard />
          </div>
          <p style={{ ...bodyP, marginBottom: 0 }}>
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>Ask the Coach:</span> And when you have a question, the coach answers in context. It sees your profile, your history, today's workout, and your strengths and weaknesses — so the answer is specific to you, not generic internet advice.
          </p>
          {/* Coach-chat screen (rowing-pacing example). */}
          <div style={{ marginTop: 20 }}>
            <CoachChat />
          </div>
        </div>
      </section>

      {/* ===== It Learns From Every Workout ===== */}
      <section className="landing-explainer" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="landing-container" style={{ maxWidth: 760 }}>
          <Eyebrow>It Learns From Every Workout</Eyebrow>
          <h2 style={sectionHeadline}>Most programs stay fixed. Yours adapts.</h2>
          <p style={bodyP}>
            Every workout you've ever done — every score, every RPE, every quality rating — becomes context. When your coach designs your next session, it doesn't start from scratch. It starts with everything you've already done.
          </p>
          <div style={{ maxWidth: 640, margin: '24px auto' }}>
            <MetconHistory />
          </div>
          <p style={bodyP}>
            This is the raw material your coach uses to understand you — your strengths, your gaps, your patterns across every time domain and movement. Not just a searchable list. Context that shapes every decision.
          </p>
          <p style={bodyP}>
            Over time, it calibrates to you. The coach learns how your reported effort and quality align with your actual output. The more you train, the sharper its read on you gets.
          </p>
          <p style={{ ...bodyP, marginBottom: 0 }}>
            Your program isn't a fixed plan — it's a working model that adjusts to how you respond. <span style={{ fontWeight: 600, color: 'var(--text)' }}>Always available. Never forgets. Getting smarter with every rep.</span>
          </p>
        </div>
      </section>

      {/* ===== Plans ===== */}
      <section className="landing-explainer" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="landing-container" style={{ maxWidth: 720 }}>
          <h2 style={{ ...sectionHeadline, textAlign: 'center' }}>Let's Make Some Gains.</h2>
          <p style={{ textAlign: 'center', fontSize: 18, fontWeight: 700, color: 'var(--text)', maxWidth: 600, margin: '0 auto 12px' }}>
            Your evaluation identifies your gaps. Your program fixes them.
          </p>
          <p style={{ ...bodyP, textAlign: 'center', maxWidth: 600, margin: '0 auto 28px' }}>
            Two programs, one bundle. The AI coach, analytics, and competition rankings come with all of them.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16, margin: '0 auto 24px', maxWidth: 480 }}>
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
              <p>Both programs together. The complete system.</p>
            </Link>
          </div>
          <p style={{ ...bodyP, marginBottom: 8 }}>Every plan includes your AI coach, full analytics, and competition rankings. No add-ons. No hidden fees.</p>
          <p style={{ ...bodyP, marginBottom: 0 }}>
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>Not ready to commit?</span> Start with your free evaluation. No obligation. No credit card. Just a complete picture of where you stand — and unlimited access to every past-Open workout. Pick a plan when you're ready.
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
