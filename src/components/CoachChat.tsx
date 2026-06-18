import { useState, useEffect, useRef, useCallback } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, CHAT_ENDPOINT, getAuthHeaders } from '../lib/supabase';

interface CoachMessage {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

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

/**
 * Day-context AI Coach chat. Asks the `chat` edge fn with the workout passed as
 * context (workout_id) and persists/rehydrates the thread from chat_messages
 * (context_type='workout', context_id=workout.id). Shared by the standalone
 * Coach page and the inline day surface.
 */
export default function CoachChat({ session, workoutId }: { session: Session; workoutId: string | null }) {
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
        if (row.question) prior.push({ role: 'user', content: row.question });
        if (row.answer) prior.push({ role: 'assistant', content: row.answer });
      }
      if (prior.length) setMessages(prior);
    })();
    return () => { cancelled = true; };
  }, [workoutId, session.user.id]);

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
          } catch { /* ignore malformed SSE line */ }
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
