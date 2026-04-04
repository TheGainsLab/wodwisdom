import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase, FunctionsHttpError } from '../lib/supabase';
import { CHAT_ENDPOINT, getAuthHeaders } from '../lib/supabase';
import Nav from '../components/Nav';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ReviewSource { title: string; author?: string; source?: string; }

interface ReviewBlockCue {
  movement: string;
  cues: string[];
  common_faults: string[];
}

interface ReviewBlock {
  block_type: string;
  block_label: string;
  prescription?: string;
  time_domain: string;
  cues_and_faults: ReviewBlockCue[];
}

interface WorkoutReview {
  intent: string;
  blocks?: ReviewBlock[];
  sources: ReviewSource[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
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

const BLOCK_TYPE_LABELS: Record<string, string> = {
  skills: 'Skills',
  strength: 'Strength',
  metcon: 'Metcon',
};

const CHEVRON_DOWN = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

// ---------------------------------------------------------------------------
// Movement card component
// ---------------------------------------------------------------------------
function MovementCard({ cf }: { cf: ReviewBlockCue }) {
  return (
    <div className="wr-movement-card">
      <div className="wr-movement-name">{cf.movement}</div>
      {cf.cues && cf.cues.length > 0 && (
        <ul className="wr-cue-list">
          {cf.cues.map((cue, j) => (
            <li key={j} className="wr-cue-item">
              <svg className="wr-cue-icon wr-cue-icon--do" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              <span>{cue}</span>
            </li>
          ))}
        </ul>
      )}
      {cf.common_faults && cf.common_faults.length > 0 && (
        <ul className="wr-cue-list wr-fault-list">
          {cf.common_faults.map((fault, j) => (
            <li key={j} className="wr-cue-item wr-fault-item">
              <svg className="wr-cue-icon wr-cue-icon--avoid" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              <span>{fault}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collapsible block component
// ---------------------------------------------------------------------------
function CollapsibleBlock({ block, defaultOpen }: { block: ReviewBlock; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const label = BLOCK_TYPE_LABELS[block.block_type] || block.block_label;

  return (
    <div className="workout-review-section workout-review-block">
      <button
        className="workout-review-block-header"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <div className="workout-review-block-title">
          <span className={`workout-review-block-badge workout-review-block-badge--${block.block_type}`}>
            {label}
          </span>

        </div>
        <span className={`workout-review-block-chevron${open ? ' workout-review-block-chevron--open' : ''}`}>
          {CHEVRON_DOWN}
        </span>
      </button>

      {open && (
        <div className="workout-review-block-body">
          {block.prescription && (
            <div className={`wr-prescription wr-prescription--${block.block_type}`}>
              <div className="workout-review-content" dangerouslySetInnerHTML={{ __html: formatMarkdown(block.prescription) }} />
            </div>
          )}

          {block.time_domain && (
            <div className="wr-time-domain">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
              <div className="workout-review-content" dangerouslySetInnerHTML={{ __html: formatMarkdown(block.time_domain) }} />
            </div>
          )}

          {block.cues_and_faults && block.cues_and_faults.length > 0 && (
            <div className="wr-movement-cards">
              {block.cues_and_faults.map((cf, i) => (
                <MovementCard key={i} cf={cf} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Coach Chat component — inline chat on the Coach view
// ---------------------------------------------------------------------------
interface CoachMessage {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

function CoachChat({ workoutId }: { session: Session; workoutId: string | null; workoutText: string }) {
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => { scrollToBottom(); }, [messages]);

  const sendMessage = useCallback(async () => {
    const question = input.trim();
    if (!question || isLoading) return;

    const userMsg: CoachMessage = { role: 'user', content: question };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const resp = await fetch(CHAT_ENDPOINT, {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({
          question,
          history: [...messages, userMsg].slice(-10),
          source_filter: 'all',
          include_profile: true,
          workout_id: workoutId,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json();
        setMessages(prev => [...prev, { role: 'assistant', content: err.error || 'Failed to get response' }]);
        setIsLoading(false);
        return;
      }

      // Stream the response
      setMessages(prev => [...prev, { role: 'assistant', content: '', streaming: true }]);
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'delta' && event.text) {
              fullText += event.text;
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: 'assistant', content: fullText, streaming: true };
                return updated;
              });
            }
            if (event.type === 'done') {
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: 'assistant', content: fullText };
                return updated;
              });
            }
          } catch {}
        }
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Failed to connect.' }]);
    }
    setIsLoading(false);
  }, [input, isLoading, messages, workoutId]);

  return (
    <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--accent)', marginBottom: 12 }}>
        AI Coach
      </div>

      {/* Messages */}
      {messages.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16, maxHeight: 400, overflowY: 'auto' }}>
          {messages.map((m, i) => (
            <div key={i} style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
              background: m.role === 'user' ? 'var(--accent)' : 'var(--surface2)',
              color: m.role === 'user' ? 'white' : 'var(--text-dim)',
              padding: '10px 14px',
              borderRadius: m.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
              fontSize: 14,
              lineHeight: 1.6,
            }}>
              <div dangerouslySetInnerHTML={{ __html: formatMarkdown(m.content || '...') }} />
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Input */}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
          placeholder="Ask about pacing, scaling, substitutions..."
          style={{
            flex: 1, padding: '12px 14px', fontSize: 14,
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
            color: 'var(--text)', fontFamily: "'Outfit', sans-serif",
          }}
          disabled={isLoading}
        />
        <button
          onClick={sendMessage}
          disabled={isLoading || !input.trim()}
          style={{
            width: 44, height: 44, borderRadius: 8, border: 'none',
            background: 'var(--accent)', color: 'white', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            opacity: isLoading || !input.trim() ? 0.5 : 1,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
        </button>
      </div>
    </div>
  );
}

export default function WorkoutReviewPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const location = useLocation();
  // Restore cached review: check localStorage by source_id first, then sessionStorage (only for freestyle)
  const savedReview = (() => {
    try {
      const sid = (location.state as { source_id?: string } | null)?.source_id;
      if (sid) {
        const raw = localStorage.getItem(`wr_review_${sid}`);
        if (raw) return JSON.parse(raw) as { workoutText: string; review: WorkoutReview };
        return null; // has source_id but no cached review — don't fall back to sessionStorage
      }
      const raw = sessionStorage.getItem('wr_last_review');
      if (raw) return JSON.parse(raw) as { workoutText: string; review: WorkoutReview };
    } catch {}
    return null;
  })();
  const [workoutText, setWorkoutText] = useState(savedReview?.workoutText ?? '');
  const [review, setReview] = useState<WorkoutReview | null>(savedReview?.review ?? null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const [tier, setTier] = useState<'free' | 'paid'>('free');
  const [totalUsage, setTotalUsage] = useState(0);
  const freeLimit = 3;
  const [tierLoaded, setTierLoaded] = useState(false);

  const fromProgramState = location.state as {
    workout_text?: string;
    source_id?: string;
    program_id?: string;
    week_num?: number;
    day_num?: number;
  } | null;
  const hasAutoAnalyzed = useRef(false);

  useEffect(() => {
    (async () => {
      const [{ data: profile }, { data: entitlements }] = await Promise.all([
        supabase.from('profiles').select('role').eq('id', session.user.id).single(),
        supabase.from('user_entitlements').select('id')
          .eq('user_id', session.user.id)
          .eq('feature', 'workout_review')
          .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString())
          .limit(1),
      ]);

      const isPaid = profile?.role === 'admin' || (entitlements && entitlements.length > 0);
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
      const { data, error } = await supabase.functions.invoke('workout-review', {
        body: { workout_text: trimmed, source_id: fromProgramState?.source_id },
      });

      if (error) {
        if (error instanceof FunctionsHttpError && error.context) {
          try {
            const body = await error.context.json();
            if (body?.code === 'FREE_LIMIT') setTotalUsage(3);
          } catch {}
        }
        throw new Error((error as { message?: string }).message || 'Something went wrong');
      }
      if (data?.error) throw new Error(data.error || 'Something went wrong');

      const reviewData = data?.review as WorkoutReview;
      setReview(reviewData);
      // Persist review: localStorage by source_id for cross-session cache, sessionStorage as fallback
      try {
        const payload = JSON.stringify({ workoutText: trimmed, review: reviewData });
        if (fromProgramState?.source_id) {
          localStorage.setItem(`wr_review_${fromProgramState.source_id}`, payload);
        }
        sessionStorage.setItem('wr_last_review', payload);
      } catch {}
      // Only bump usage counter when it wasn't a cached response
      if (!data?.cached && (!tierLoaded || tier === 'free')) {
        setTotalUsage(prev => prev + 1);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to analyze workout');
    } finally {
      setIsLoading(false);
    }
  };

  // Auto-analyze when opened from program with workout pre-filled (runs once)
  // Skip API call entirely if we already loaded a cached review from localStorage
  useEffect(() => {
    const text = fromProgramState?.workout_text?.trim();
    if (!text || !tierLoaded || hasAutoAnalyzed.current) return;
    if (review) { hasAutoAnalyzed.current = true; return; }
    if (tier === 'free' && totalUsage >= freeLimit) return;
    hasAutoAnalyzed.current = true;
    setWorkoutText(text);
    analyzeWorkout(text);
  }, [fromProgramState?.workout_text, tierLoaded, tier, totalUsage]);

  const usagePill = tier === 'free'
    ? <div className="usage-pill">{totalUsage}/{freeLimit} free</div>
    : null;

  const hasBlocks = review?.blocks && review.blocks.length > 0;
  const weekDay = fromProgramState?.week_num != null && fromProgramState?.day_num != null
    ? `Week ${fromProgramState.week_num} \u00b7 Day ${fromProgramState.day_num}`
    : null;

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>Coach</h1>
          {tierLoaded && usagePill}
        </header>

        <div className="page-body">
          <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 0' }}>
            {fromProgramState?.workout_text && !review && !error ? (
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
                {/* Week / Day header */}
                {weekDay && (
                  <div className="wr-week-day-header">{weekDay}</div>
                )}

                {/* Intent — always visible at top */}
                {review.intent && (
                  <div className="wr-intent-card">
                    <div className="wr-intent-label">Training Intent</div>
                    <div className="workout-review-content" dangerouslySetInnerHTML={{ __html: formatMarkdown(review.intent) }} />
                  </div>
                )}

                {/* Per-block coaching sections */}
                {hasBlocks && (
                  <>
                    {review.blocks!.map((block, i) => (
                      <CollapsibleBlock
                        key={i}
                        block={block}
                        defaultOpen={false}
                      />
                    ))}
                  </>
                )}

                {/* Sources — collapsed at bottom */}
                {review.sources && review.sources.length > 0 && (
                  <SourcesSection sources={review.sources} />
                )}

                {/* Coach Chat */}
                <CoachChat
                  session={session}
                  workoutId={fromProgramState?.source_id || null}
                  workoutText={workoutText}
                />

                {/* Actions */}
                <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
                  <button
                    className="auth-btn"
                    onClick={() => navigate('/workout/start', {
                      state: {
                        workout_text: workoutText,
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
                      onClick={() => { setReview(null); setWorkoutText(''); hasAutoAnalyzed.current = false; try { sessionStorage.removeItem('wr_last_review'); } catch {} }}
                      style={{ flex: 1, minWidth: 160, background: 'var(--surface2)', color: 'var(--text)' }}
                    >
                      Coach Another Workout
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

// ---------------------------------------------------------------------------
// Sources — collapsible at the bottom
// ---------------------------------------------------------------------------
function SourcesSection({ sources }: { sources: ReviewSource[] }) {
  const [open, setOpen] = useState(false);
  const titles = [...new Set(sources.map(s => s.title).filter(Boolean))];
  if (titles.length === 0) return null;

  return (
    <div className="wr-sources-section">
      <button className="wr-sources-toggle" onClick={() => setOpen(!open)}>
        <span className="wr-sources-label">Sources ({titles.length})</span>
        <span className={`workout-review-block-chevron${open ? ' workout-review-block-chevron--open' : ''}`}>
          {CHEVRON_DOWN}
        </span>
      </button>
      {open && (
        <div className="wr-sources-list">
          {titles.map((t, j) => (
            <span key={j} className="source-chip">{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}
