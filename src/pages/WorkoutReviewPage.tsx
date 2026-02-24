import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { WORKOUT_REVIEW_ENDPOINT, supabase } from '../lib/supabase';
import Nav from '../components/Nav';
import InviteBanner from '../components/InviteBanner';

interface ReviewScaling { movement: string; suggestions: string; }
interface ReviewCues { movement: string; cues: string[]; }
interface ReviewSource { title: string; author?: string; source?: string; }

interface WorkoutReview {
  time_domain: string;
  scaling: ReviewScaling[];
  warm_up: string;
  cues: ReviewCues[];
  class_prep: string;
  sources: ReviewSource[];
}

function formatMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n- /g, '<br>\u2022 ')
    .replace(/\n/g, '<br>')
    .replace(/^/, '<p>')
    .replace(/$/, '</p>')
    .replace(/<p><\/p>/g, '');
}

export default function WorkoutReviewPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [workoutText, setWorkoutText] = useState('');
  const [review, setReview] = useState<WorkoutReview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const [tier, setTier] = useState<'free' | 'paid'>('free');
  const [totalUsage, setTotalUsage] = useState(0);
  const freeLimit = 3;
  const [tierLoaded, setTierLoaded] = useState(false);

  const fromProgramState = location.state as { workout_text?: string; source_type?: string; source_id?: string; program_id?: string } | null;
  const hasAutoAnalyzed = useRef(false);

  useEffect(() => {
    (async () => {
      const { data: profile } = await supabase
        .from('profiles')
        .select('subscription_status')
        .eq('id', session.user.id)
        .single();

      const isPaid = profile?.subscription_status === 'active';
      setTier(isPaid ? 'paid' : 'free');

      if (!isPaid) {
        const [{ count: chatCount }, { count: reviewCount }] = await Promise.all([
          supabase.from('chat_messages').select('id', { count: 'exact', head: true }).eq('user_id', session.user.id),
          supabase.from('workout_reviews').select('id', { count: 'exact', head: true }).eq('user_id', session.user.id),
        ]);
        setTotalUsage((chatCount || 0) + (reviewCount || 0));
      }
      setTierLoaded(true);
    })();
  }, [session.user.id]);

  // Auto-analyze when opened from program with workout pre-filled

  const isPaywalled = tier === 'free' && totalUsage >= freeLimit;

  const analyzeWorkout = async (textOverride?: string) => {
    const trimmed = (textOverride ?? workoutText).trim();
    if (!trimmed || isLoading || isPaywalled) return;
    if (trimmed.length < 10) {
      setError('Paste a complete workout to analyze');
      return;
    }

    setError('');
    setReview(null);
    setIsLoading(true);

    try {
      const resp = await fetch(WORKOUT_REVIEW_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + session.access_token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ workout_text: trimmed }),
      });

      const data = await resp.json();

      if (!resp.ok) {
        if (resp.status === 402 && data.code === 'FREE_LIMIT') {
          setTotalUsage(3);
        }
        throw new Error(data.error || 'Something went wrong');
      }

      setReview(data.review as WorkoutReview);
      if (!tierLoaded || tier === 'free') {
        setTotalUsage(prev => prev + 1);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to analyze workout');
    } finally {
      setIsLoading(false);
    }
  };

  // Auto-analyze when opened from program with workout pre-filled (runs once)
  useEffect(() => {
    const text = fromProgramState?.workout_text?.trim();
    if (!text || !tierLoaded || hasAutoAnalyzed.current) return;
    if (tier === 'free' && totalUsage >= freeLimit) return;
    hasAutoAnalyzed.current = true;
    setWorkoutText(text);
    analyzeWorkout(text);
  }, [fromProgramState?.workout_text, tierLoaded, tier, totalUsage]);

  const usagePill = tier === 'free'
    ? <div className="usage-pill">{totalUsage}/{freeLimit} free</div>
    : null;

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <InviteBanner session={session} />
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>Review Workout</h1>
          {tierLoaded && usagePill}
        </header>

        <div className="page-body">
          <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 0' }}>
            {fromProgramState?.workout_text && isLoading ? (
              <div className="page-loading" style={{ padding: 48 }}><div className="loading-pulse" /></div>
            ) : !review ? (
              <div className="workout-review-input-wrap">
                <textarea
                  className="workout-review-textarea"
                  value={workoutText}
                  onChange={e => setWorkoutText(e.target.value)}
                  placeholder="Paste a workout to analyze...&#10;&#10;e.g. 4 RFT: 20 wall balls 20/14, 10 toes to bar, 5 power cleans 135/95"
                  rows={6}
                  disabled={isPaywalled}
                />
                {error && <div className="auth-error" style={{ display: 'block', marginTop: 12 }}>{error}</div>}
                {isPaywalled ? (
                  <div className="paywall-card" style={{ marginTop: 24 }}>
                    <div className="paywall-icon">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                    </div>
                    <h3>You've used your 3 free questions</h3>
                    <p>Upgrade to get unlimited access to workout reviews and the full coaching knowledge base.</p>
                    <button className="paywall-btn" onClick={() => navigate('/checkout')}>Upgrade Now</button>
                  </div>
                ) : (
                  <button
                    className="auth-btn"
                    onClick={() => analyzeWorkout()}
                    disabled={isLoading || !workoutText.trim()}
                    style={{ marginTop: 16 }}
                  >
                    {isLoading ? 'Analyzing...' : 'Analyze Workout'}
                  </button>
                )}
              </div>
            ) : (
              <div className="workout-review-result">
                <div className="workout-review-section">
                  <h3>Time Domain</h3>
                  <div className="workout-review-content" dangerouslySetInnerHTML={{ __html: formatMarkdown(review.time_domain) }} />
                </div>

                {review.scaling && review.scaling.length > 0 && (
                  <div className="workout-review-section">
                    <h3>Scaling</h3>
                    {review.scaling.map((s, i) => (
                      <div key={i} className="workout-review-movement">
                        <strong>{s.movement}</strong>
                        <div className="workout-review-content" dangerouslySetInnerHTML={{ __html: formatMarkdown(s.suggestions) }} />
                      </div>
                    ))}
                  </div>
                )}

                {review.warm_up && (
                  <div className="workout-review-section">
                    <h3>Warm-up</h3>
                    <div className="workout-review-content" dangerouslySetInnerHTML={{ __html: formatMarkdown(review.warm_up) }} />
                  </div>
                )}

                {review.cues && review.cues.length > 0 && (
                  <div className="workout-review-section">
                    <h3>Cues</h3>
                    {review.cues.map((c, i) => (
                      <div key={i} className="workout-review-movement">
                        <strong>{c.movement}</strong>
                        <ul className="workout-review-cues">
                          {(c.cues || []).map((cue, j) => (
                            <li key={j}>{cue}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}

                {review.class_prep && (
                  <div className="workout-review-section">
                    <h3>Class Prep</h3>
                    <div className="workout-review-content" dangerouslySetInnerHTML={{ __html: formatMarkdown(review.class_prep) }} />
                  </div>
                )}

                {review.sources && review.sources.length > 0 && (
                  <div className="sources-bar" style={{ marginTop: 24 }}>
                    <span className="sources-label">Sources</span>
                    {[...new Set(review.sources.map(s => s.title).filter(Boolean))].map((t, j) => (
                      <span key={j} className="source-chip">{t}</span>
                    ))}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
                  <button
                    className="auth-btn"
                    onClick={() => navigate('/workout/start', {
                      state: {
                        workout_text: workoutText,
                        source_type: fromProgramState?.source_type ?? 'review',
                        source_id: fromProgramState?.source_id ?? null,
                      },
                    })}
                    style={{ flex: 1, minWidth: 160 }}
                  >
                    Start This Workout
                  </button>
                  {fromProgramState?.program_id ? (
                    <button
                      className="auth-btn"
                      onClick={() => navigate(`/programs/${fromProgramState.program_id}`)}
                      style={{ flex: 1, minWidth: 160, background: 'var(--surface2)', color: 'var(--text)' }}
                    >
                      Back to program
                    </button>
                  ) : (
                    <button
                      className="auth-btn"
                      onClick={() => { setReview(null); setWorkoutText(''); hasAutoAnalyzed.current = false; }}
                      style={{ flex: 1, minWidth: 160, background: 'var(--surface2)', color: 'var(--text)' }}
                    >
                      Review Another Workout
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
