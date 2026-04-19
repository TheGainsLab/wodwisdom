import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase, CHAT_ENDPOINT, getAuthHeaders } from '../lib/supabase';
import Nav from '../components/Nav';
import { formatMarkdown } from '../lib/formatMarkdown';
import { loadUserProgress, getProgramMapping, loadWorkoutForDay, type EngineWorkout } from '../lib/engineService';
import { ChevronLeft } from 'lucide-react';

interface CoachMessage {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

function CoachChat({ engineProgramDay }: { engineProgramDay: number }) {
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async () => {
    const question = input.trim();
    if (!question || isLoading) return;

    const userMsg: CoachMessage = { role: 'user', content: question };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const resp = await fetch(CHAT_ENDPOINT, {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({
          question,
          history: [...messages, userMsg].slice(-10),
          engine_program_day: engineProgramDay,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        setMessages((prev) => [...prev, { role: 'assistant', content: err?.error || 'Failed to get response' }]);
        setIsLoading(false);
        return;
      }

      setMessages((prev) => [...prev, { role: 'assistant', content: '', streaming: true }]);
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
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: 'assistant', content: fullText, streaming: true };
                return updated;
              });
            }
            if (event.type === 'done') {
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: 'assistant', content: fullText };
                return updated;
              });
            }
          } catch {
            // ignore malformed SSE lines
          }
        }
      }
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Failed to connect.' }]);
    }
    setIsLoading(false);
  }, [input, isLoading, messages, engineProgramDay]);

  return (
    <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--accent)', marginBottom: 12 }}>
        AI Coach
      </div>

      {messages.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16, maxHeight: 480, overflowY: 'auto' }}>
          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                background: m.role === 'user' ? 'var(--accent)' : 'var(--surface2)',
                color: m.role === 'user' ? 'white' : 'var(--text-dim)',
                padding: '10px 14px',
                borderRadius: m.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                fontSize: 14,
                lineHeight: 1.6,
              }}
            >
              <div dangerouslySetInnerHTML={{ __html: formatMarkdown(m.content || '…') }} />
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
          placeholder="Ask about pacing, the day type, recent sessions…"
          style={{
            flex: 1,
            padding: '12px 14px',
            fontSize: 14,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            color: 'var(--text)',
            fontFamily: "'Outfit', sans-serif",
          }}
          disabled={isLoading}
        />
        <button
          onClick={sendMessage}
          disabled={isLoading || !input.trim()}
          style={{
            width: 44,
            height: 44,
            borderRadius: 8,
            border: 'none',
            background: 'var(--accent)',
            color: 'white',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: isLoading || !input.trim() ? 0.5 : 1,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default function EngineTrainingDayReviewPage({ session: _session }: { session: Session }) {
  const { dayNumber } = useParams<{ dayNumber: string }>();
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [programVersion, setProgramVersion] = useState<string | null>(null);
  const [workout, setWorkout] = useState<EngineWorkout | null>(null);
  const [dayTypeName, setDayTypeName] = useState<string>('');

  const programDay = Number(dayNumber);

  useEffect(() => {
    (async () => {
      try {
        const progress = await loadUserProgress();
        const version = progress?.engine_program_version || null;
        setProgramVersion(version);
        if (!version) {
          setLoading(false);
          return;
        }

        const mapping = await getProgramMapping(version);
        const entry = mapping.find((m) => m.program_sequence_order === programDay);
        if (!entry) {
          setLoading(false);
          return;
        }

        const w = await loadWorkoutForDay(entry.engine_workout_day_number);
        setWorkout(w);

        if (w?.day_type) {
          const { data: dt } = await supabase
            .from('engine_day_types')
            .select('name')
            .eq('id', w.day_type)
            .maybeSingle();
          setDayTypeName(dt?.name || w.day_type);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [programDay]);

  if (!Number.isFinite(programDay) || programDay <= 0) {
    return (
      <div className="app-layout">
        <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
        <div className="main-content">
          <header className="page-header">
            <button className="menu-btn" onClick={() => navigate('/engine')}>
              <ChevronLeft size={20} />
            </button>
            <h1>Coach</h1>
          </header>
          <div className="page-body">
            <p style={{ color: 'var(--text-dim)' }}>Invalid day.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => navigate(`/engine/training/${programDay}`)}>
            <ChevronLeft size={20} />
          </button>
          <h1>Coach</h1>
        </header>
        <div className="page-body">
          <div style={{ maxWidth: 720, margin: '0 auto' }}>
            {loading ? (
              <div className="page-loading">
                <div className="loading-pulse" />
              </div>
            ) : !programVersion ? (
              <p style={{ color: 'var(--text-dim)' }}>
                You don't have an active Engine program. Start one from the{' '}
                <button
                  onClick={() => navigate('/engine')}
                  style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, fontSize: 'inherit' }}
                >
                  Engine dashboard
                </button>
                .
              </p>
            ) : (
              <>
                <div className="settings-card">
                  <h2 className="settings-card-title" style={{ marginBottom: 4 }}>
                    Day {programDay}
                    {dayTypeName ? ` — ${dayTypeName.replace(/_/g, ' ')}` : ''}
                  </h2>
                  <p style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 4 }}>
                    Ask the coach about pacing, the day type's purpose, how this session fits your recent training, or what's coming next.
                  </p>
                </div>

                {workout && (
                  <div className="settings-card" style={{ marginTop: 12 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 13, color: 'var(--text-dim)' }}>
                      {workout.total_duration_minutes ? <span>Target duration: {workout.total_duration_minutes} min</span> : null}
                      {workout.base_intensity_percent ? <span>Base intensity: {workout.base_intensity_percent}%</span> : null}
                      {workout.block_count ? <span>Blocks: {workout.block_count}</span> : null}
                    </div>
                  </div>
                )}

                <CoachChat engineProgramDay={programDay} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
