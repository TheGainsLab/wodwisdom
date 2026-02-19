import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import '../landing.css';

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

const FAQ_ITEMS = [
  {
    q: 'What sources does WodWisdom use?',
    a: 'WodWisdom is built on hundreds of articles from the CrossFit Journal, exercise physiology textbooks, and the CrossFit Kids Training Guide. Every answer includes source citations so you can verify the information.',
  },
  {
    q: 'Is this an official CrossFit product?',
    a: 'No. WodWisdom is an independent tool built by coaches, for coaches. It uses publicly available CrossFit educational materials as its knowledge base.',
  },
  {
    q: 'Can I try it before paying?',
    a: 'Yes! Every new account gets 3 free questions so you can see the quality of answers before committing to a subscription.',
  },
  {
    q: "What's the difference between the Coach and Gym plans?",
    a: 'The Coach plan is for individuals. The Gym plan includes up to 3 coach seats so you can invite your coaching staff, plus a management dashboard to add and remove team members.',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes. There are no contracts or commitments. You can cancel your subscription at any time and retain access through the end of your billing period.',
  },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [activeDemo, setActiveDemo] = useState(0);
  const goToAuth = () => navigate('/auth');
  const goToCheckout = () => navigate('/auth?next=/checkout');

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
            <span className="landing-logo">W</span>
            <span className="landing-brand-name">WodWisdom</span>
          </div>
          <nav className="landing-nav">
            <a href="#how-it-works">How It Works</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
          </nav>
          <button className="landing-signin-btn" onClick={goToAuth}>Sign In</button>
        </div>
      </header>

      {/* ===== Hero ===== */}
      <section className="landing-hero">
        <h1 className="landing-hero-title">Fitness intelligence.</h1>
        <p className="landing-hero-sub">
          Every journal article, seminar, and study guide — trained into one AI, available 24/7.
        </p>
        <button className="landing-cta" onClick={goToAuth}>Get Started</button>
      </section>

      {/* ===== Explainer ===== */}
      <section className="landing-explainer">
        <div className="landing-container">
          <h2 className="landing-section-title">Bigger brains, bigger gains</h2>
          <div className="landing-explainer-grid">
            <p>
              Every CrossFit journal article, seminar, and study guide, trained into one AI.{' '}
              A coach who has learned everything and never forgets a word — and never sleeps.{' '}
              The information you need all in one place. No need to dig around online or flip through social media reels for a cue or a hint. It's all here.
            </p>
            <p>
              Flip on Science Mode and go deeper. We trained WodWisdom on graduate-level physiology
              texts — so when you want to geek out and get technical, it's there.
            </p>
          </div>
        </div>
      </section>

      {/* ===== See It In Action ===== */}
      <section className="landing-demo">
        <div className="landing-container">
          <h2 className="landing-section-title">See it in action</h2>
          <div className="landing-demo-tabs">
            {DEMO_EXAMPLES.map((ex, i) => (
              <button
                key={ex.tab}
                className={'landing-demo-tab' + (activeDemo === i ? ' active' : '')}
                onClick={() => setActiveDemo(i)}
              >
                {ex.tab}
              </button>
            ))}
          </div>
          <div className="landing-demo-card">
            <div className="landing-demo-q">
              <div className="msg-body user">{DEMO_EXAMPLES[activeDemo].question}</div>
            </div>
            <div className="landing-demo-a">
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

      {/* ===== Who It's For ===== */}
      <section className="landing-audience">
        <div className="landing-container">
          <h2 className="landing-section-title">Built for the CrossFit community</h2>
          <div className="landing-audience-grid">
            <div className="landing-audience-card">
              <div className="landing-audience-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" /></svg>
              </div>
              <h3>Coaches</h3>
              <p>You're the intelligence layer between the workouts and the athletes. Coaches turn a program turn it into a personalized experience — pacing guidance, movement cues, scaling, warm-ups, the works. WodWisdom gives you instant access to the full methodology so you can deliver outstanding training every time. Walk into every class prepared.</p>
            </div>
            <div className="landing-audience-card">
              <div className="landing-audience-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></svg>
              </div>
              <h3>Athletes</h3>
              <p>Your program was built by a great coach. But it's built for everyone, not for you. WodWisdom turns a program into your program. Get personalized pacing guidance, warm-up and mobility work, and scaling options that match your level. Ask it to review your performance and suggest work you can do on your own. Same program, better results.</p>
            </div>
            <div className="landing-audience-card">
              <div className="landing-audience-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
              </div>
              <h3>Gym Owners</h3>
              <p>Fitness and helping others are your passion and your livelihood. WodWisdom handles the details that separate an average gym from a great one — and that keep members coming back. Review programming, generate class briefings, write warm-ups and cool-downs, surface movement cues your coaches can use on the spot. Add up to three coaches to your account so your entire team has full access to the knowledge base. Make every class excellent.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== How It Works ===== */}
      <section id="how-it-works" className="landing-steps">
        <div className="landing-container">
          <h2 className="landing-section-title">How it works</h2>
          <div className="landing-steps-grid">
            <div className="landing-step">
              <div className="landing-step-num">1</div>
              <h3>You ask</h3>
              <p>Ask anything related to fitness, training, nutrition, programming and more. General questions, specific questions, any questions. Review workouts. Nutrition planning. Anything and everything health and fitness.</p>
            </div>
            <div className="landing-step">
              <div className="landing-step-num">2</div>
              <h3>We search</h3>
              <p>Our AI is trained to search thousands of journal articles, study guides, seminar content and more. Flip on science mode and gain access to graduate level anatomy, physiology and biochemistry.</p>
            </div>
            <div className="landing-step">
              <div className="landing-step-num">3</div>
              <h3>You get the answer</h3>
              <p>Get a clear, sourced answer. WodWisdom thoroughly answers your question, and sources every article so you can dig in further. Need a quick answer? Click summarize and get a bulleted list. Bookmark it for easy reference, and fire away with follow up questions.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== Pricing ===== */}
      <section id="pricing" className="landing-pricing">
        <div className="landing-container">
          <h2 className="landing-section-title">Simple pricing</h2>
          <p className="landing-section-sub">Start with 3 free questions. Upgrade when you're ready.</p>
          <div className="landing-pricing-grid">
            <div className="landing-pricing-card">
              <h3>Coach</h3>
              <div className="landing-price">$7.99<span>/mo</span></div>
              <ul className="landing-pricing-features">
                <li>Unlimited questions</li>
                <li>Full source library</li>
                <li>Bookmarks & summaries</li>
                <li>Search history</li>
              </ul>
              <button className="landing-cta" onClick={goToCheckout}>Subscribe</button>
            </div>
            <div className="landing-pricing-card featured">
              <div className="landing-pricing-badge">Best for teams</div>
              <h3>Gym</h3>
              <div className="landing-price">$24.99<span>/mo</span></div>
              <ul className="landing-pricing-features">
                <li>Everything in Coach</li>
                <li>Up to 3 coach seats</li>
                <li>Gym dashboard</li>
                <li>Invite & manage coaches</li>
              </ul>
              <button className="landing-cta" onClick={goToCheckout}>Subscribe</button>
            </div>
          </div>
        </div>
      </section>

      {/* ===== FAQ ===== */}
      <section id="faq" className="landing-faq">
        <div className="landing-container">
          <h2 className="landing-section-title">Frequently asked questions</h2>
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

      {/* ===== Footer CTA ===== */}
      <section className="landing-footer-cta">
        <h2>The best coaches never stop learning.</h2>
        <button className="landing-cta" onClick={goToAuth}>Get Started</button>
      </section>

      <footer className="landing-footer">
        WodWisdom
      </footer>
    </div>
  );
}
