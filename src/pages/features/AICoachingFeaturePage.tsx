import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import GainsLogo from '../../components/GainsLogo';
import '../../features.css';

function ChatExample({ question, children, scienceMode }: { question: string; children: React.ReactNode; scienceMode?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="feature-chat-card">
      {/* User question */}
      <div className="feature-chat-user">
        <div className="feature-chat-user-bubble">{question}</div>
      </div>
      {/* AI response */}
      <div className="feature-chat-assistant">
        <div className="feature-chat-avatar">G</div>
        <div className="feature-chat-response-wrap">
          {scienceMode && (
            <span className="feature-chat-mode-badge feature-chat-mode-badge--science">Science Mode</span>
          )}
          <div className={`feature-chat-response${expanded ? ' expanded' : ''}`}>
            <div className="feature-chat-response-inner">
              {children}
            </div>
            {!expanded && <div className="feature-chat-fade" />}
          </div>
          <button className="feature-chat-expand" onClick={() => setExpanded(e => !e)}>
            {expanded ? 'Collapse' : 'See full response'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AICoachingFeaturePage() {
  const navigate = useNavigate();

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
        <span className="feature-hero-badge">AI Coaching</span>
        <h1 className="feature-hero-title">AI that knows your athlete</h1>
        <p className="feature-hero-sub">
          We trained an AI on the CrossFit methodology — every study guide, journal article, and seminar.
          Ask it anything about training, nutrition, movement, or recovery. Get answers grounded in real
          methodology, not generic fitness advice.
        </p>
        <p className="feature-hero-sub">
          No profile required.
        </p>
      </section>

      {/* Real Chat Examples */}
      <section className="feature-section">
        <div className="feature-container">
          <h2 className="feature-section-title">Ask anything</h2>
          <p className="feature-section-sub">
            Pacing strategy. Movement cues. Scaling options. Competition prep. Skills practice. Nutrition planning.
            Program review. Whatever you need — the AI speaks your language and coaches in real time.
          </p>

          <ChatExample question="When I snatch, I can pull high enough, but sometimes miss in the catch at weights I can make. What might be causing this and how can I correct it?">
            <p>Your issue sounds like a classic overhead position problem rather than a pulling deficit. If you're pulling high enough but missing catches on weights you can make, the fault is likely in your receiving position and stability.</p>
            <p>The most common culprit is inactive shoulders in the catch. As the Level 1 guide emphasizes, you need "active shoulders" - shoulders pulled up tight to your ears by the traps, not yielding to the load. When you catch with passive shoulders, the bar crashes down and you lose the lift despite having the strength to hold it.</p>
            <p>Given your overhead squat max of 265 lbs and snatch of 245 lbs, you clearly have the strength. The issue is likely positional. Check if you're catching with your shoulders properly engaged - they should be "tucked up next to the ear" as gymnasts say. A passive shoulder yields to the load and kills the lift.</p>
            <p>Your beginner-level deficit HSPU rating suggests overhead positioning might be a weak link. Work overhead squat holds at lighter weights, focusing on active shoulder engagement throughout the entire range of motion. Practice snatching from blocks or hang positions to isolate the receiving position without the fatigue of the full lift.</p>
            <p>Also examine your footwork in the catch. Are you landing in your optimal squat stance? Poor foot positioning can compromise your receiving position even if your pull is perfect.</p>
            <p>Drill pause overhead squats at 185-205 lbs, holding the bottom for 3 seconds with active shoulders. This will build the stability and positioning awareness you need to stick those catches consistently.</p>
            <div className="feature-chat-sources">
              <span className="feature-chat-sources-label">Sources</span>
              <span className="feature-chat-chip">Errors, Cues and Exaggerations</span>
              <span className="feature-chat-chip">CFJ English Level1 TrainingGuide</span>
              <span className="feature-chat-chip">37 05 lifting shoulder</span>
            </div>
          </ChatExample>

          <ChatExample question="I want to develop all the energy systems to support my fitness and do better in CrossFit. Can you help me understand phosphocreatine resynthesis and how my training can enhance it?" scienceMode>
            <p>The phosphocreatine (PCr) system is your most explosive energy pathway, providing immediate power for roughly 8-10 seconds of maximal effort. Looking at your profile, this system is what drives your heavy lifts like that 555lb deadlift and powers the first few reps of high-intensity movements.</p>
            <p><strong>How PCr Works &amp; Recovers:</strong> PCr acts as an "ATP buffer" - when you fire up muscle contraction, ATP gets broken down to ADP, and PCr instantly donates its phosphate to regenerate ATP. This happens within fractions of a second, making it your fastest energy source. The key insight is that PCr resynthesis occurs through aerobic metabolism - your mitochondria use oxygen to rebuild those PCr stores.</p>
            <p>Recovery follows a specific timeline: you'll restore about 50% of PCr within 30 seconds, 75% by 1 minute, and 95% by 2-3 minutes. This is why you can hit multiple heavy singles with adequate rest but struggle to maintain power in rapid-fire MetCons.</p>
            <p><strong>Training Applications for You:</strong> Given your strength levels, focus on these PCr development strategies:</p>
            <p><strong>1. Alactic Power Intervals:</strong> 10-15 second all-out efforts with 45-90 seconds rest. Try 8x15s bike sprints or 6x30m sprints with full recovery.</p>
            <p><strong>2. Cluster Training:</strong> Break your strength work into clusters - instead of 5 straight reps, do 5x1 with 10-15 seconds between reps. This maintains PCr availability for each rep.</p>
            <p><strong>3. Aerobic Base Development:</strong> Since oxidative metabolism refuels PCr, your steady-state work (like that 16:54 5k row) directly supports power recovery between efforts.</p>
            <p><strong>CrossFit-Specific Considerations:</strong> Most MetCons don't allow full PCr recovery, which is why you see power drop-off after round 1-2. Train this reality with incomplete rest protocols, but also develop maximum capacity with full recovery work. Your wall-facing HSPU and kipping pull-up practice already targets this system well - just ensure adequate rest between sets to maximize quality and PCr development.</p>
            <div className="feature-chat-sources">
              <span className="feature-chat-sources-label">Sources</span>
              <span className="feature-chat-chip feature-chat-chip--science">84 Sports Physiology</span>
              <span className="feature-chat-chip feature-chat-chip--science">72 Energetics And Metabolic Rate</span>
              <span className="feature-chat-chip feature-chat-chip--science">Lehninger's Principles of Biochemistry - 13.2</span>
            </div>
          </ChatExample>
        </div>
      </section>

      {/* Sourced */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row reverse">
            <div className="feature-text">
              <h3>Every recommendation is sourced</h3>
              <p>
                WodWisdom doesn't make things up. Every evaluation pulls from real training methodology —
                CrossFit Journal articles, seminar content, exercise physiology textbooks, and more.
                You can trace any recommendation back to its source material.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer CTA */}
      <section className="feature-footer-cta">
        <h2>Get your evaluation today.</h2>
        <button className="feature-cta" onClick={() => navigate('/auth?signup=1')}>Try it Free</button>
      </section>

      <footer className="feature-footer"><GainsLogo /></footer>
    </div>
  );
}
