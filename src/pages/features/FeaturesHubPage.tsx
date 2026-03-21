import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import GainsLogo from '../../components/GainsLogo';
import '../../features.css';

const DEMO_EXAMPLES = [
  {
    tab: 'Coaching',
    question: 'Evaluate the following workout for my gym. Four rounds for time: 20 wall balls at 20/14 to 10/9 foot target, 10 toes to bar, five power cleans 135/95. Provide suggestions for preparing a class',
    answer: [
      <>This is a solid triplet that progresses from high-volume/light-load to low-volume/heavy-load. The workout structure allows athletes to recover grip and breathing during power cleans while hitting different energy systems.</>,
      <><strong>Time Domain &amp; Expectations</strong> Expect 12–18 minutes for most athletes. Wall balls will be the limiting factor early, while power cleans become the bottleneck as rounds progress. Athletes should complete round one in 3–4 minutes — if they're taking longer, scale immediately.</>,
      <><strong>Movement Scaling Priorities</strong> For wall balls, reduce ball weight before target height. A 14/10 lb ball maintains the squat-throw pattern better than lowering the target significantly. Consider 10/8 foot targets for newer athletes.</>,
      <>Toes to bar scale to knee raises, then hanging knee raises, then strict knee raises. Preserve the hanging/grip element when possible.</>,
      <>Power cleans are your biggest scaling concern at 135/95 — that's relatively heavy for a fatigued state. Scale to 115/75 or even 95/65 for intermediate athletes. Focus on maintaining hip drive and proper catch position rather than grinding through heavy loads with poor mechanics.</>,
      <><strong>Class Preparation</strong> Warm up thoroughly with air squats, wall ball progressions, and hanging work. Spend significant time on clean setup and technique review — this movement will deteriorate fastest under fatigue.</>,
      <>Brief athletes on pacing: wall balls in 2–3 sets maximum, quick transitions, and treating power cleans as recovery time with deliberate setup. Consider running scaled versions through one full round during warm-up to test appropriateness.</>,
      <>The high rep count (140 wall balls total) makes this volume-intensive, so don't hesitate to reduce rounds to three for newer athletes.</>,
    ],
    sources: ['CrossFit Level 2 Training Guide', 'CrossFit Journal — Scaling'],
  },
  {
    tab: 'Nutrition',
    question: 'I do CrossFit at 9am. I am up at 6, get kids ready for school, then I get breakfast. My goals are fitness and performance, and I train once a day. Any guidance on morning nutrition before and after class? Specific suggestions welcome',
    answer: [
      <>Your timing gives you a solid three-hour window, which is perfect for proper fueling. Here's what I'd recommend:</>,
      <><strong>Pre-workout (6–7am):</strong> Focus on easily digestible carbs with minimal fat and fiber to avoid GI distress. Think banana with a small amount of nut butter, oatmeal with berries, or toast with honey. If you handle dairy well, Greek yogurt with fruit works too. Avoid large amounts of protein, fat, or fiber that take energy to digest.</>,
      <><strong>Hydration:</strong> Drink 16–20oz of water upon waking, then sip another 8–12oz leading up to your workout. You don't need sports drinks for a one-hour session — water is sufficient.</>,
      <><strong>Post-workout:</strong> This is your key recovery window. Within 30–60 minutes, prioritize protein and carbs to kickstart recovery. Eggs with toast, protein smoothie with fruit, or Greek yogurt with granola all work well. Since you're training for performance, aim for 20–30g of quality protein and similar carbs.</>,
      <>The CrossFit prescription emphasizes real food over supplements. Your body adapts well to consistent timing, so whatever pattern you choose, stick with it. Since you're up early managing kids and training hard, don't overthink it — focus on foods you enjoy and digest well.</>,
      <>Pay attention to how different pre-workout meals affect your performance and adjust accordingly. Some people thrive on more food, others prefer training closer to fasted.</>,
    ],
    sources: ['CrossFit Journal — Nutrition', 'CrossFit Level 1 Training Guide'],
  },
  {
    tab: 'Movement',
    question: 'A few athletes in my class are working on stringing together toes to bar. Can you suggest some cues or guidance to help them?',
    answer: [
      <>For stringing together toes to bar, focus on the connection between reps rather than individual reps. The key is maintaining momentum and rhythm.</>,
      <><strong>Critical transition cues:</strong> "Don't stop at the bottom" — most athletes lose their string by coming to a dead hang. "Keep the swing alive" — maintain a slight hollow-to-arch rhythm even between reps. "Quick touch and go" — brief contact with the bar, then immediately back into the next rep.</>,
      <><strong>Rhythm and timing:</strong> Think of it like a pendulum that never fully stops. Athletes should practice the hollow-arch cycle continuously on the bar before adding the actual toe contact. Have them hang and practice 5–10 small kips without bringing toes up, just to feel the rhythm.</>,
      <><strong>Grip and positioning:</strong> Encourage a slightly wider grip than strict pull-ups — this gives more room for the legs to come through. Keep shoulders slightly forward of the bar throughout the movement to maintain better swing mechanics.</>,
      <><strong>Common faults to watch:</strong> Many athletes pike too hard at the top, which kills momentum. Cue "light tap" rather than driving knees to chest. Others let their shoulders go completely passive at the bottom — they need to maintain some tension to keep the swing going.</>,
      <><strong>Practice progression:</strong> Start with hanging leg raises focusing on rhythm, then progress to alternating single-leg touches, then full toes to bar. The goal is smooth, continuous movement rather than stopping between each rep.</>,
    ],
    sources: ['CrossFit Journal — Toes to Bar', 'CrossFit Level 2 Training Guide'],
  },
  {
    tab: 'Science',
    question: 'Does conditioning generally improve the ability of muscle cells to extract oxygen from blood?',
    answer: [
      <>Yes, conditioning significantly improves the ability of muscle cells to extract oxygen from blood through several key adaptations.</>,
      <>During exercise, muscle cells become much more efficient at pulling oxygen from the blood flowing through them. The physiological texts show that during strenuous exercise, the <strong>utilization coefficient</strong> — the percentage of oxygen that muscle cells extract from blood as it passes through tissue capillaries — can increase dramatically from about 25% at rest to 75–85% during intense exercise. In highly active muscle areas, utilization coefficients approaching 100% have been recorded.</>,
      <>Training enhances this oxygen extraction capacity through multiple mechanisms. First, conditioning increases the number of open capillaries during exercise. While some muscle capillaries have little to no blood flow at rest, strenuous exercise opens all available capillaries, creating a 2–3 fold increase in capillary surface area. This dramatically reduces the distance oxygen must diffuse from capillaries to working muscle fibers.</>,
      <>The trained muscle also becomes better at creating the local chemical environment that facilitates oxygen release. During exercise, muscles release carbon dioxide, acids, and heat — all of which shift the <strong>oxygen-hemoglobin dissociation curve</strong> to the right. This forces oxygen to be released from hemoglobin at higher tissue pressures, making it more available to muscle cells even when 70% of the oxygen has already been extracted.</>,
      <>Additionally, conditioned muscles develop enhanced metabolic machinery at the cellular level that can more efficiently utilize the extracted oxygen for energy production. This combination of improved delivery, extraction, and utilization makes trained muscle remarkably efficient at grabbing and using oxygen from the blood supply.</>,
    ],
    sources: ['Guyton & Hall — Textbook of Medical Physiology', 'CrossFit Journal — Conditioning'],
  },
];

const FEATURES = [
  {
    title: 'AI Coaching',
    description: 'Get a comprehensive AI evaluation of any athlete — strength ratios, skills assessment, conditioning analysis, and personalized priorities. Like having a head coach who has read every journal article and never forgets a detail.',
    path: '/features/ai-coaching',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a5 5 0 0 1 5 5v3a5 5 0 0 1-10 0V7a5 5 0 0 1 5-5z" />
        <path d="M17 10v1a5 5 0 0 1-10 0v-1" />
        <path d="M12 19v3" />
        <path d="M8 22h8" />
      </svg>
    ),
  },
  {
    title: 'Programs',
    description: 'Upload any training program and get instant AI analysis — weekly volume breakdown, movement patterns, energy system balance, and smart modification suggestions tailored to your athletes.',
    path: '/features/programs',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
        <rect x="8" y="2" width="8" height="4" rx="1" />
      </svg>
    ),
  },
  {
    title: 'Engine',
    description: 'Advanced conditioning intelligence. See every training day classified by workout type, track your conditioning across time domains, and visualize your training balance with analytics and heatmaps.',
    path: '/features/engine',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    title: 'Nutrition',
    description: 'Track your fuel with a barcode scanner, food search, and meal builder. Build meal templates, log daily intake, and get AI-powered guidance on pre- and post-workout nutrition.',
    path: '/features/nutrition',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
        <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
        <line x1="6" y1="1" x2="6" y2="4" />
        <line x1="10" y1="1" x2="10" y2="4" />
        <line x1="14" y1="1" x2="14" y2="4" />
      </svg>
    ),
  },
];

export default function FeaturesHubPage() {
  const navigate = useNavigate();
  const [activeDemo, setActiveDemo] = useState(0);

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
            <a href="/#how-it-works">How It Works</a>
            <a href="/#pricing">Pricing</a>
          </nav>
          <Link to="/auth" className="feature-signin-btn">Sign In</Link>
        </div>
      </header>

      {/* Hero */}
      <section className="feature-hero">
        <h1 className="feature-hero-title">See what WodWisdom can do</h1>
        <p className="feature-hero-sub">
          AI-powered coaching, programming, conditioning analytics, and nutrition tracking — built for the CrossFit community.
        </p>
      </section>

      {/* Feature Cards */}
      <section style={{ padding: '0 0 80px' }}>
        <div className="feature-container">
          <div className="feature-hub-grid">
            {FEATURES.map((f) => (
              <Link key={f.path} to={f.path} className="feature-hub-card">
                <div className="feature-hub-icon">{f.icon}</div>
                <div className="feature-hub-content">
                  <h3>{f.title}</h3>
                  <p>{f.description}</p>
                  <span className="feature-hub-link">
                    See more
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* See It In Action */}
      <section className="feature-demo">
        <div className="feature-container">
          <h2 className="feature-section-title">See it in action</h2>
          <p className="feature-section-sub">Real questions, real answers — powered by hundreds of journal articles, seminars, and textbooks.</p>
          <div className="feature-demo-tabs">
            {DEMO_EXAMPLES.map((ex, i) => (
              <button
                key={ex.tab}
                className={'feature-demo-tab' + (activeDemo === i ? ' active' : '')}
                onClick={() => setActiveDemo(i)}
              >
                {ex.tab}
              </button>
            ))}
          </div>
          <div className="feature-demo-card">
            <div className="feature-demo-q">
              <div className="msg-body user">{DEMO_EXAMPLES[activeDemo].question}</div>
            </div>
            <div className="feature-demo-a">
              <div className="msg-header">
                <span className="msg-avatar">W</span>
              </div>
              <div className="msg-body assistant">
                {DEMO_EXAMPLES[activeDemo].answer.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
              <div className="sources-bar">
                <span className="sources-label">Sources</span>
                {DEMO_EXAMPLES[activeDemo].sources.map((s, i) => (
                  <span key={i} className="source-chip">{s}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer CTA */}
      <section className="feature-footer-cta">
        <h2>Ready to train smarter?</h2>
        <button className="feature-cta" onClick={() => navigate('/auth?signup=1')}>Try it Free</button>
      </section>

      <footer className="feature-footer"><GainsLogo /></footer>
    </div>
  );
}
