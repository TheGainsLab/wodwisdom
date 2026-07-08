import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import GainsLogo from '../../components/GainsLogo';
import '../../features.css';

const SUPABASE_BASE = import.meta.env.VITE_SUPABASE_URL || 'https://hsiqzmbfulmfxbvbsdwz.supabase.co';
const CHECKOUT_ENDPOINT = SUPABASE_BASE + '/functions/v1/create-checkout';

// Real-HTML per-movement cues (✓) and faults (✗) — replaces task-guidance-image.png.
function TaskGuidanceCard() {
  const movements: { name: string; cues: string[]; faults: string[] }[] = [
    {
      name: 'Burpee',
      cues: [
        "Stay low and fast — don't fully stand and pause between reps. Jump your feet in and explode up in one fluid motion to keep cycle time tight.",
        "Control your breathing during burpees: exhale hard on the push-up, inhale on the jump. With 9 reps per round at your bodyweight, uncontrolled breathing will blow up your heart rate before the thrusters.",
        "Jump and clap with purpose but don't over-extend — get your feet moving toward the bar the moment you land. The burpee is a transition INTO the thruster, not a resting movement.",
      ],
      faults: [
        "Slowing to a walk between burpees in rounds 3–5 as HR spikes — commit to a steady rhythmic pace rather than sprinting 3 and dying on the last 6.",
        "Sloppy push-up position (sagging hips or worm-style) under fatigue — keep a rigid plank on every rep. A no-rep costs more time than a clean slow rep.",
      ],
    },
    {
      name: 'Thruster',
      cues: [
        "115 lbs is light for you — go unbroken all 5 rounds, no exceptions. Drive out of the bottom of the squat explosively and use that hip drive to punch the bar overhead so your arms aren't pressing it up.",
        "Rack position must be tight: elbows up, bar on shoulders, before each squat. After 9 burpees your upper back will want to round — fight it. Keep chest tall and elbows punching forward on the descent.",
        "Lock out hard at the top and immediately descend into the next rep — don't pause or reset overhead. With only 6 reps per round, the goal is 6 smooth fast reps and bar down in under 20 seconds.",
      ],
      faults: [
        "Forward lean in the squat causing the bar to drift out — you had this fault flagged on June 9. Cue: keep the torso vertical, drive knees out, and think 'elbows up' throughout the squat portion.",
        "Breaking the thruster into a front squat + press under fatigue — if you catch yourself pressing separately, lower the weight next time. This round, commit to the drive-through: hips and arms finish together.",
      ],
    },
    {
      name: 'Bar Muscle Up',
      cues: [
        "With only 3 reps per round, go unbroken every single set. Your butterfly pull-up is advanced — use that kip aggressively to generate the hip-to-bar height you need, then punch down hard in the transition.",
        "After thrusters, your grip and lats are pre-fatigued. Chalk up before round 1 and re-chalk if needed. Approach the bar with full intent — don't hang and wait. Kip immediately on contact.",
        "In rounds 4–5 when lat fatigue sets in, focus on the false grip or a strong re-grip on top of the bar in the dip. The dip and press-out phase is where intermediate bar MU athletes lose their reps — stay patient through the turnover and press tall.",
      ],
      faults: [
        "Missing the transition (chest not clearing the bar) due to insufficient hip drive after thrusters — if your kip feels flat, take one extra swing to reload rather than muscling a half-rep that costs energy and risks a no-rep.",
        "Rushing the set-up after thrusters and jumping on the bar before the hips are ready — 2-second pause, hands set, then go. Wasted reps here end your sub-7 finish.",
      ],
    },
  ];
  return (
    <div style={{ maxWidth: 560, margin: '24px auto 0', background: 'var(--surface)', border: '1px solid #ffffff', borderRadius: 16, padding: '22px 24px', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 22 }}>
      {movements.map((m, mi) => (
        <div key={mi} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{m.name}</div>
          {m.cues.map((c, i) => (
            <div key={`c${i}`} style={{ display: 'flex', gap: 10, fontSize: 15, lineHeight: 1.55, color: 'var(--text-dim)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 3 }}><polyline points="20 6 9 17 4 12" /></svg>
              <span>{c}</span>
            </div>
          ))}
          {m.faults.map((f, i) => (
            <div key={`f${i}`} style={{ display: 'flex', gap: 10, fontSize: 15, lineHeight: 1.55, color: 'var(--text-dim)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 3 }}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              <span>{f}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// Real-HTML "Today's Training Intent" card (replaces Training-Intent-image.png).
function TrainingIntentCard() {
  return (
    <div style={{ maxWidth: 560, margin: '24px auto 0', background: 'var(--surface)', border: '1px solid #ffffff', borderRadius: 16, padding: '22px 24px', textAlign: 'left' }}>
      <div style={{ textTransform: 'uppercase', letterSpacing: '1px', fontSize: 14, fontWeight: 700, color: 'var(--accent)', marginBottom: 14 }}>Today's Training Intent</div>
      <p style={{ fontSize: 15, lineHeight: 1.65, color: 'var(--text-dim)', margin: 0 }}>
        This session is built around front squat development as the structural anchor: the squat-focused warm-up (squat therapy, Cossack squats, goblet squats) primes hip mobility and positional awareness, while the skills EMOM is placed first — before the strength block — to leverage a fresh CNS for the motor learning demands of handstand walk (spatial orientation, balance, wrist loading) and ring muscle-up maintenance (timing, transition quality), both of which degrade rapidly under fatigue. The front squat block at 80% (285 lbs × 4×5, RPE 8) then drives maximal force production through the posterior chain and anterior core, with the Bulgarian split squats and single-arm rows reinforcing unilateral leg strength and posterior chain balance that directly support squat integrity; the V-ups sustain midline stiffness that ties directly to both the squats and the handstand work. The metcon closes the session as a short anaerobic power finisher — the 9-6-3 thruster/burpee/bar muscle-up triplet at 115 lbs targets the phosphocreatine and fast glycolytic systems and intentionally challenges thruster mechanics under accumulated fatigue, making it a functional test of the movement quality built earlier in the session, particularly relevant given the forward-lean thruster fault flagged in recent training.
      </p>
    </div>
  );
}

// Real-HTML metcon block + game plan (replaces strategy-image.png).
function MetconBlockCard() {
  const movements = [
    { name: 'Burpee', scheme: '5×9' },
    { name: 'Thruster', scheme: '5×6 · 115 lbs' },
    { name: 'Bar Muscle Up', scheme: '5×3' },
  ];
  const ctrl = (label: string, accent: boolean) => (
    <span style={{ fontSize: 12, fontWeight: 600, color: accent ? 'var(--accent)' : 'var(--text-dim)', border: `1px solid ${accent ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 6, padding: '4px 9px', display: 'inline-flex', alignItems: 'center' }}>{label}</span>
  );
  return (
    <div style={{ maxWidth: 560, margin: '24px auto 0', background: 'var(--surface)', border: '1px solid #ffffff', borderRadius: 16, padding: '20px 22px', textAlign: 'left' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#34d399', background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.4)', borderRadius: 6, padding: '3px 8px' }}>Metcon</span>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Short power triplet</span>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>cap 7 min</span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>{ctrl('Edit', false)}{ctrl('AI Edit', true)}{ctrl('Coach', true)}</span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)', marginBottom: 8 }}>5 Rds For Time: 9-6-3</div>
      {movements.map((m, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '10px 0', borderTop: i === 0 ? 'none' : '1px dashed var(--border)', fontSize: 15 }}>
          <span style={{ color: 'var(--text)' }}>{m.name}</span>
          <span style={{ color: 'var(--text-dim)', fontFamily: "'JetBrains Mono', monospace", whiteSpace: 'nowrap' }}>{m.scheme}</span>
        </div>
      ))}
      <div style={{ textAlign: 'center', margin: '14px 0 4px' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', border: '1px solid #ffffff', borderRadius: 8, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
          Log block
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
        </span>
      </div>
      <div style={{ border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg)', padding: '16px 18px', marginTop: 12 }}>
        <div style={{ textTransform: 'uppercase', letterSpacing: '1px', fontSize: 13, fontWeight: 700, color: 'var(--accent)', marginBottom: 8 }}>Game Plan</div>
        <p style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--text-dim)', margin: 0 }}>
          Target 5:30–6:30, hard cap at 7:00. At 115 lbs (~32% of your 355 front squat), the thrusters are light enough to go unbroken every round — the bar should never come down. Primary limiter will be the bar muscle-ups in later rounds (3–4 and 5) as lat and grip fatigue accumulate from the burpees and thruster overhead lockout. Burpees will spike heart rate fast given your bodyweight (225 lbs) — that's the engine tax that bleeds into the muscle-ups. Pacing strategy: treat rounds 1–2 as controlled-aggressive, minimize rest at transitions, and push rounds 3–5 knowing the reps drop. No settling in — this is a sprint from the jump. The biggest time leaks will be standing around before getting on the bar for muscle-ups. Keep transition time under 5 seconds every time.
        </p>
      </div>
    </div>
  );
}

// Real-HTML "Weaknesses & Priorities" eval excerpt (replaces weak-eval.png),
// styled to match this page's screenshots (1px white border, 16px radius).
function WeaknessesCard() {
  const items = [
    'GHD sit-ups are a major liability at beginner level, evidenced by your 17th-percentile competition performance — this movement appears frequently in higher-level competition.',
    'Deficit HSPU and legless rope climbs remain at beginner level, creating vulnerability to advanced gymnastics progressions that separate qualifier from regional-level athletes.',
    'Strong lift numbers, but technical Olympic lifting weakness — your snatch at 1.09× BW and C&J at 1.40× BW are both below the 0.60 and 0.75 ratios relative to your back squat strength.',
    'Long-duration aerobic capacity is your biggest competitive gap — ranking only 68.68th percentile in monostructural-long events, with your 20:11 5K run being particularly limiting.',
  ];
  return (
    <div style={{ maxWidth: 560, margin: '24px auto 0', background: 'var(--surface)', border: '1px solid #ffffff', borderRadius: 16, padding: '22px 24px', textAlign: 'left' }}>
      <div style={{ textTransform: 'uppercase', letterSpacing: '1px', fontSize: 14, fontWeight: 700, color: 'var(--accent)', marginBottom: 16 }}>Weaknesses &amp; Priorities</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {items.map((t, i) => (
          <div key={i} style={{ display: 'flex', gap: 10 }}>
            <span style={{ flex: '0 0 auto', fontSize: 16, fontWeight: 700, lineHeight: 1.6, color: 'var(--accent)' }}>{i + 1}.</span>
            <span style={{ fontSize: 16, lineHeight: 1.6, color: 'var(--text-dim)' }}>{t}</span>
          </div>
        ))}
      </div>
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
        <p className="feature-hero-sub" style={{ fontSize: 'clamp(20px,3vw,26px)', fontWeight: 700, color: 'var(--text)' }}>
          The Program That Follows You.
        </p>
        <p className="feature-hero-body">
          Built from your evaluation — strength, skills, conditioning, and competition history — then aimed at the adaptations that move your fitness the most. You train on what's holding you back, so you get fitter faster.
        </p>
      </section>

      {/* Step 1 — Evaluation */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row reverse">
            <div className="feature-text">
              <h3 style={{ textAlign: 'center' }}>Your evaluation drives everything.</h3>
              <p>
                It pinpoints where you rank, what's holding you back, and what to fix first.
              </p>
              <WeaknessesCard />
              <p style={{ marginTop: 28 }}>
                Those gaps become your program. The AI takes your profile and goals and turns them into work on your calendar — Olympic lifts, gymnastics, aerobic engine. Nothing gets ignored.
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
              <h3 style={{ textAlign: 'center' }}>Inside a Training Day</h3>
              <p>Every day breaks down into blocks — warm-up to cooldown — each with loads, targets, and coaching cues.</p>
              <img src="/images/Training-Day-Image.png" alt="A full training day — warm-up, skills, strength, accessory, metcon, and cool-down" className="feature-img" style={{ maxWidth: 560 }} />
              <p style={{ marginTop: 24 }}>Need to adjust? Edit lets you make changes manually. Or use AI Edit — just tell the coach what you need: &ldquo;I want to go a little heavier&rdquo; or &ldquo;My rower broke — substitute something else?&rdquo; The AI rebuilds that piece of the session around your request.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Coach, Every Block */}
      <section className="feature-section" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="feature-container">
          <div className="feature-row">
            <div className="feature-text">
              <h3 style={{ textAlign: 'center' }}>Coach, Every Block</h3>
              <p>Tap any block and the coach explains the why — not just what to do, but what adaptation you're chasing and how it fits into your bigger picture.</p>
              <TrainingIntentCard />
              <p style={{ marginTop: 24 }}>Every session opens with intent. You know what you're training, why it matters, and how it connects to your goals — before you move a single rep.</p>
              <p style={{ marginTop: 24 }}>Need a game plan? Tap the Metcon and the coach gives you pacing, target times, and where the leaks usually happen.</p>
              <MetconBlockCard />
              <p style={{ marginTop: 24 }}>Tap any movement and get specific cues — tied to your history and your faults. Not generic advice. Your coach knows your numbers, your weaknesses, and what you're working on.</p>
              <TaskGuidanceCard />
              <p style={{ marginTop: 24 }}>And when you have a question, the coach answers in context. It sees your profile, your history, today's workout, and your strengths and weaknesses — so the answer is specific to you.</p>
              <img src="/images/AI-Coach-Image.png" alt="The AI coach answering a question in the context of your training day" className="feature-img" style={{ maxWidth: 560 }} />
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
              <h3>AI Programming — {interval === 'monthly' ? '$29.99/mo' : '$74.99/qtr'}</h3>
              <p>
                Includes AI Coach and Nutrition.
              </p>
              <div style={{ display: 'flex', maxWidth: 280, margin: '16px 0 0', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                <button type="button" style={{ flex: 1, padding: '10px 0', border: 'none', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer', background: interval === 'monthly' ? 'var(--accent)' : 'transparent', color: interval === 'monthly' ? 'white' : 'var(--text-dim)', transition: 'all .15s' }} onClick={() => setInterval('monthly')}>Monthly</button>
                <button type="button" style={{ flex: 1, padding: '10px 0', border: 'none', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer', background: interval === 'quarterly' ? 'var(--accent)' : 'transparent', color: interval === 'quarterly' ? 'white' : 'var(--text-dim)', transition: 'all .15s' }} onClick={() => setInterval('quarterly')}>Quarterly</button>
              </div>
              <div style={{ display: 'flex', marginTop: 16 }}>
                <button className="feature-cta" onClick={buyProgramming} disabled={checkoutLoading}>{checkoutLoading ? 'Redirecting...' : 'Get Started'}</button>
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
