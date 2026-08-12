import { useState, useEffect, useRef, useCallback } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, CHAT_ENDPOINT, APPLY_BLOCK_EDIT_ENDPOINT, getAuthHeaders } from '../lib/supabase';
import { movementToLine, type BlockProposal } from '../pages/ProgramDetailPage';

interface ProposalData {
  ai_edit_log_id: string;
  block_id: string;
  block_type: string;
  rationale: string;
  original: BlockProposal;
  proposal: BlockProposal;
}

type CoachMessage =
  | { kind: 'text'; role: 'user' | 'assistant'; content: string; streaming?: boolean }
  | { kind: 'proposal'; data: ProposalData; status: 'pending' | 'applying' | 'applied' | 'kept' | 'error' };

function formatMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n- /g, '<br>• ')
    .replace(/\n/g, '<br>')
    .replace(/^/, '<p>')
    .replace(/$/, '</p>')
    .replace(/<p><\/p>/g, '');
}

/** One side of the proposal card: scheme line + movement lines. */
function ProposalBlockLines({ block }: { block: BlockProposal }) {
  return (
    <>
      {block.block_scheme && (
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>{block.block_scheme}</div>
      )}
      {block.movements.map((m, i) => (
        <div key={i} style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5 }}>{movementToLine(m)}</div>
      ))}
    </>
  );
}

/**
 * Day-context AI Coach chat. Asks the `chat` edge fn with the workout passed as
 * context (workout_id) and persists/rehydrates the thread from chat_messages
 * (context_type='workout', context_id=workout.id). Shared by the standalone
 * Coach page and the inline day surface.
 *
 * The coach's hands (2026-08-12): in day-scoped programming chat the coach can
 * propose an edit to one block. The proposal arrives as an SSE `proposal`
 * event and renders as a card with Apply / Keep — nothing changes unless the
 * athlete taps Apply, which resolves through the apply-block-edit fn and then
 * bumps `onDayChanged` so the page refetches its blocks. Cards are in-session
 * only (the thread rehydrates text; the applied change lives in the day).
 */
export default function CoachChat({ session, workoutId, onDayChanged }: {
  session: Session;
  workoutId: string | null;
  onDayChanged?: () => void;
}) {
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => { scrollToBottom(); }, [messages]);

  // Rehydrate this day's prior coach conversation so it's there in context when
  // the user returns to the workout. The chat fn already persists each message
  // to chat_messages tagged context_type='workout' + context_id=workout.id; we
  // just reload that thread (oldest-first) into the box.
  useEffect(() => {
    if (!workoutId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('chat_messages')
        .select('question, answer, created_at')
        .eq('user_id', session.user.id)
        .eq('context_type', 'workout')
        .eq('context_id', workoutId)
        .order('created_at', { ascending: true })
        .limit(50);
      if (cancelled || !data) return;
      const prior: CoachMessage[] = [];
      for (const row of data as { question: string; answer: string }[]) {
        if (row.question) prior.push({ kind: 'text', role: 'user', content: row.question });
        if (row.answer) prior.push({ kind: 'text', role: 'assistant', content: row.answer });
      }
      if (prior.length) setMessages(prior);
    })();
    return () => { cancelled = true; };
  }, [workoutId, session.user.id]);

  const resolveProposal = useCallback(async (logId: string, action: 'apply' | 'decline') => {
    setMessages(prev => prev.map(m =>
      m.kind === 'proposal' && m.data.ai_edit_log_id === logId
        ? { ...m, status: action === 'apply' ? 'applying' : m.status }
        : m
    ));
    try {
      const resp = await fetch(APPLY_BLOCK_EDIT_ENDPOINT, {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ ai_edit_log_id: logId, action }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || `Failed (${resp.status})`);
      setMessages(prev => prev.map(m =>
        m.kind === 'proposal' && m.data.ai_edit_log_id === logId
          ? { ...m, status: action === 'apply' ? 'applied' : 'kept' }
          : m
      ));
      if (action === 'apply') onDayChanged?.();
    } catch {
      setMessages(prev => prev.map(m =>
        m.kind === 'proposal' && m.data.ai_edit_log_id === logId ? { ...m, status: 'error' } : m
      ));
    }
  }, [onDayChanged]);

  const sendMessage = useCallback(async () => {
    const question = input.trim();
    if (!question || isLoading) return;

    const userMsg: CoachMessage = { kind: 'text', role: 'user', content: question };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    // History for the model: text turns only (proposal cards ride the day, not
    // the transcript — the coach already narrated them in text).
    const historyForModel = [...messages, userMsg]
      .filter((m): m is Extract<CoachMessage, { kind: 'text' }> => m.kind === 'text')
      .map(m => ({ role: m.role, content: m.content }))
      .slice(-10);

    try {
      const resp = await fetch(CHAT_ENDPOINT, {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({
          question,
          history: historyForModel,
          source_filter: 'all',
          include_profile: true,
          workout_id: workoutId,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json();
        setMessages(prev => [...prev, { kind: 'text', role: 'assistant', content: err.error || 'Failed to get response' }]);
        setIsLoading(false);
        return;
      }

      // Stream the response. Text deltas accumulate into ONE assistant bubble;
      // a `proposal` event splices a card after the text so far (the coach's
      // wrap-up continues into the same bubble below the card visually).
      setMessages(prev => [...prev, { kind: 'text', role: 'assistant', content: '', streaming: true }]);
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      const updateStreamingText = (text: string) => {
        setMessages(prev => {
          const updated = [...prev];
          for (let i = updated.length - 1; i >= 0; i--) {
            const m = updated[i];
            if (m.kind === 'text' && m.role === 'assistant' && m.streaming) {
              updated[i] = { ...m, content: text };
              break;
            }
          }
          return updated;
        });
      };

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
              updateStreamingText(fullText);
            }
            if (event.type === 'proposal' && event.ai_edit_log_id) {
              // Card lands after the current text; the coach's wrap-up keeps
              // streaming into a fresh bubble beneath it.
              const card: CoachMessage = {
                kind: 'proposal',
                status: 'pending',
                data: {
                  ai_edit_log_id: event.ai_edit_log_id,
                  block_id: event.block_id,
                  block_type: event.block_type,
                  rationale: event.rationale || '',
                  original: event.original,
                  proposal: event.proposal,
                },
              };
              fullText = '';
              setMessages(prev => {
                const updated = [...prev];
                // Close the current streaming bubble (drop it if empty).
                for (let i = updated.length - 1; i >= 0; i--) {
                  const m = updated[i];
                  if (m.kind === 'text' && m.role === 'assistant' && m.streaming) {
                    if (m.content.trim()) updated[i] = { ...m, streaming: false };
                    else updated.splice(i, 1);
                    break;
                  }
                }
                updated.push(card);
                updated.push({ kind: 'text', role: 'assistant', content: '', streaming: true });
                return updated;
              });
            }
            if (event.type === 'done') {
              setMessages(prev => {
                const updated = [...prev];
                for (let i = updated.length - 1; i >= 0; i--) {
                  const m = updated[i];
                  if (m.kind === 'text' && m.role === 'assistant' && m.streaming) {
                    if (m.content.trim()) updated[i] = { ...m, streaming: false };
                    else updated.splice(i, 1);
                    break;
                  }
                }
                return updated;
              });
            }
          } catch { /* ignore malformed SSE line */ }
        }
      }
    } catch {
      setMessages(prev => [...prev, { kind: 'text', role: 'assistant', content: 'Failed to connect.' }]);
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
          {messages.map((m, i) => m.kind === 'text' ? (
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
          ) : (
            <div key={i} style={{
              alignSelf: 'stretch',
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: '12px 14px',
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--accent)', marginBottom: 8 }}>
                Proposed change — {m.data.block_type}
              </div>
              {m.data.rationale && (
                <div style={{ fontSize: 13, color: 'var(--text-dim)', fontStyle: 'italic', marginBottom: 10 }}>{m.data.rationale}</div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 4 }}>Now</div>
                  <ProposalBlockLines block={m.data.original} />
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 4 }}>Proposed</div>
                  <ProposalBlockLines block={m.data.proposal} />
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                {m.status === 'pending' || m.status === 'applying' || m.status === 'error' ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button
                      type="button"
                      onClick={() => resolveProposal(m.data.ai_edit_log_id, 'apply')}
                      disabled={m.status === 'applying'}
                      style={{
                        padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
                        background: 'var(--accent)', color: 'white', fontSize: 13, fontWeight: 600,
                        fontFamily: "'Outfit', sans-serif", opacity: m.status === 'applying' ? 0.6 : 1,
                      }}
                    >
                      {m.status === 'applying' ? 'Applying…' : 'Apply'}
                    </button>
                    <button
                      type="button"
                      onClick={() => resolveProposal(m.data.ai_edit_log_id, 'decline')}
                      disabled={m.status === 'applying'}
                      style={{
                        padding: '8px 18px', borderRadius: 8, cursor: 'pointer',
                        background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)',
                        fontSize: 13, fontWeight: 600, fontFamily: "'Outfit', sans-serif",
                      }}
                    >
                      Keep original
                    </button>
                    {m.status === 'error' && (
                      <span style={{ fontSize: 12, color: 'var(--accent)' }}>Failed — try again</span>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)' }}>
                    {m.status === 'applied' ? '✓ Applied to your day' : 'Kept the original'}
                  </div>
                )}
              </div>
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
