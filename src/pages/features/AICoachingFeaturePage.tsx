import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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
        <h1 className="feature-hero-title">Ask anything</h1>
      </section>

      {/* Real Chat Examples */}
      <section className="feature-section">
        <div className="feature-container">
          <h2 className="feature-section-title">Real examples from real athletes</h2>
          <p className="feature-section-sub">
            Imagine a Level 4 coach who never forgets a thing. Ask about pacing, movement cues, nutrition planning, program review—or flip on science mode for a deep dive into biochemistry and physiology.
          </p>

          <ChatExample question="When I snatch, I sometimes miss in the catch. What are some drills I can do to correct this?">
            <p>Missing catches in the snatch typically stems from poor positioning, timing, or confidence in the receiving position. The key is developing comfort and strength in that bottom position through targeted skill-transfer exercises.</p>
            <p>Start with the overhead squat - this is the foundation of your catch position. Practice holding the bottom position with perfect posture, working on flexibility and stability. As Glassman notes, this movement is "the heart of the snatch" and essential for developing effective athletic movement.</p>
            <p>The snatch balance progressions are your best friends here. Begin with the pressing snatch balance: bar on your back with snatch grip, slowly squat down while pressing the bar overhead simultaneously. This teaches you to find and hold that catch position with control.</p>
            <p>Progress to the heaving snatch balance, adding a short dip and drive to initiate the movement before settling into the bottom position. This builds the timing and confidence to get under the bar quickly.</p>
            <p>Finally, work the full snatch balance - start in your pulling stance, dip and drive explosively, then dive under while moving your feet to the wider catching stance. This most closely mimics the actual catch dynamics.</p>
            <p>Practice these progressions consistently with PVC or light weight first. The catch position must become automatic and strong before you can trust it under a heavy snatch. Most athletes need far more overhead squat and snatch balance work than they think - these positions don't develop overnight but require dedicated practice to master.</p>
            <div className="feature-chat-sources">
              <span className="feature-chat-sources-label">Sources</span>
              <span className="feature-chat-chip">CFJ English Level1 TrainingGuide</span>
              <span className="feature-chat-chip">Skill Transfer Exercises for the Snatch English</span>
              <span className="feature-chat-chip">Next-Level Coaching: The Snatch</span>
            </div>
          </ChatExample>

          <ChatExample question="I don't have a ring muscle up yet. I can do 7 strict pullups, but can't get the timing right. Give me some drills and cues to get ring muscle ups.">
            <p>You've got the pulling strength, so let's work on the specific skills and timing. The muscle-up isn't just about strength - it's about coordination, false grip mastery, and understanding the transition.</p>
            <p>Start with the foundation movements from the CrossFit progression:</p>
            <p><strong>Ring Support Hold</strong> - Master this first. Get comfortable supporting your bodyweight with straight arms, rings turned out. Hold for 30+ seconds consistently.</p>
            <p><strong>Ring Dips</strong> - You need strength through the full range. Work toward getting your hands to your armpits at the bottom, then pressing to full lockout.</p>
            <p><strong>False Grip Development</strong> - This is crucial. Practice hanging from the rings with the false grip (wrist over the ring, not fingers). Your pulling strength means nothing if you lose this grip during the transition. Start with short holds and build up.</p>
            <p><strong>Kneeling Muscle-ups</strong> - Set rings low, kneel underneath, and practice the movement pattern. Focus on the transition from pull to press. This teaches the timing without the full load.</p>
            <p>The key timing cue: "Pull high, roll over, press out." You need to pull your chest well above the rings before initiating the transition. Many athletes try to transition too early.</p>
            <p>As Tucker notes in the spotting article, the muscle-up requires "kinesthetic and spatial awareness" beyond just strength. The transition happens quickly, and you need to trust the movement.</p>
            <p>Practice the elevator spot with a coach if possible - it helps you feel the proper rhythm under load while staying safe. Don't rush the progression. Master each step before moving to the next.</p>
            <div className="feature-chat-sources">
              <span className="feature-chat-sources-label">Sources</span>
              <span className="feature-chat-chip">Spotting the Muscle-Up</span>
              <span className="feature-chat-chip">CFJ English Level1 TrainingGuide</span>
              <span className="feature-chat-chip">Applications of the Support on Rings</span>
            </div>
          </ChatExample>

          <ChatExample question="I do CrossFit at 9am. I wake up at 6am. Give me some guidance about pre and post workout nutrition.">
            <p>With that 3-hour window, you've got good timing to fuel properly without feeling heavy during your workout.</p>
            <p><strong>Pre-workout (6-7am):</strong> Start with something easily digestible about 2 hours before - around 7am works well. Think moderate carbs with minimal fat and fiber that could slow digestion. A banana with a small amount of nut butter, some berries with a bit of yogurt, or even just a piece of toast. You want fuel in the tank but not a heavy meal sitting in your stomach.</p>
            <p>About 30-60 minutes before (8-8:30am), consider something lighter if needed - maybe just a few dates or a small piece of fruit. Some athletes do great fasted after that initial fuel, others need that little top-off.</p>
            <p>Hydration is critical - start drinking water when you wake up. You're dehydrated from sleep and need to be well-hydrated before that 9am session.</p>
            <p><strong>Post-workout:</strong> This is your golden window. Within 30 minutes, prioritize protein and carbs to kickstart recovery. The CrossFit prescription emphasizes quality - think real food over supplements when possible. Greek yogurt with berries, eggs with some fruit, or a quality protein shake with banana if you're rushed.</p>
            <p>Don't overthink it. The biggest mistake is either training completely fasted or eating too much too close to workout time. Your 3-hour window is actually ideal - use it to fuel appropriately without compromising performance. Pay attention to how different foods make you feel and adjust accordingly.</p>
            <div className="feature-chat-sources">
              <span className="feature-chat-sources-label">Sources</span>
              <span className="feature-chat-chip">CFJ English L2 TrainingGuide</span>
              <span className="feature-chat-chip">Scaling CrossFit Workouts</span>
              <span className="feature-chat-chip">CFJ English Level1 TrainingGuide</span>
            </div>
          </ChatExample>

          <ChatExample question="I will be traveling next week and have 3 days in a hotel gym. I'll have dumbbells, a jump rope, and exercise bikes. Can you give me 3 metcons with this equipment to help me stay sharp on the road?">
            <p>Here are three solid metcons that'll keep you sharp with dumbbells, jump rope, and bikes:</p>
            <p><strong>Day 1: "Hotel Helen"</strong> 3 rounds for time: 1000m bike (or 90 seconds moderate pace) / 21 dumbbell swings (Russian style, eye level) / 12 burpees</p>
            <p>The bike replaces the traditional 400m run but maintains that longer aerobic component. Scale the dumbbell weight so you can move continuously with good form.</p>
            <p><strong>Day 2: "Road Intervals"</strong> 5 rounds for time: 15 dumbbell thrusters / 20 double-unders (or 40 singles) / 500m bike (moderate-hard effort)</p>
            <p>This hits that mid-range time domain with mixed modal demands. The bike intervals will spike your heart rate between the upper body work and jump rope.</p>
            <p><strong>Day 3: "Travel Grind"</strong> 20 minutes AMRAP: 250m easy bike / 15 dumbbell deadlifts / 10 dumbbell push press (5 each arm) / 30 double-unders (or 60 singles)</p>
            <p>The easy bike serves as active recovery between the more intense dumbbell and jump rope work, letting you maintain a steady pace for the full 20 minutes.</p>
            <p>As the sources note about dumbbell work, these will challenge your stability and unilateral strength differently than barbells. Keep weights moderate - you want to maintain that CrossFit intensity and movement quality while staying sharp on the road.</p>
            <div className="feature-chat-sources">
              <span className="feature-chat-sources-label">Sources</span>
              <span className="feature-chat-chip">13 03 Benchmark Workouts</span>
              <span className="feature-chat-chip">Dumbbells: Did You Get the Message?</span>
            </div>
          </ChatExample>
        </div>
      </section>

      {/* Sourced */}
      <section className="feature-section">
        <div className="feature-container">
          <div className="feature-row reverse">
            <div className="feature-text">
              <h3>Every answer is sourced</h3>
              <p>
                No generic information. Every response pulls from CrossFit Journal articles, study guides, seminars, and more. Technical answers come straight from the source material—and every one can be traced back.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="feature-footer-cta">
        <h2>Get the program that follows you.</h2>
        <p style={{ maxWidth: 640, margin: '0 auto 24px', color: 'var(--text-dim)', fontSize: 15, lineHeight: 1.6 }}>
          The AI Coach answers any question without a profile. But when you add AI Programming, the coach knows
          your 1RMs, your skill levels, your conditioning benchmarks — and every coaching note in your program
          is built around your specific data.
        </p>
        <Link to="/features/programs" className="feature-cta">Learn more about AI Programming &rarr;</Link>
      </section>

      <footer className="feature-footer"><GainsLogo /></footer>
    </div>
  );
}
