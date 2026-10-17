import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DISCUSS_PAPER_ENDPOINT, getAuthHeaders, supabase } from '../lib/supabase';
import { formatMarkdown } from '../lib/formatMarkdown';
import { logKnowledgeEvent } from '../lib/knowledgeEvents';

/**
 * Discuss this paper — the research chat panel on a knowledge entry page.
 *
 * Grounded server-side in the entry's verified record (discuss-paper
 * function). The free tier is 3 questions lifetime across the whole
 * library, mirroring the main coach's meter contract (402 + FREE_LIMIT);
 * the research_chat entitlement is unlimited. Threads persist server-side,
 * one per paper, and reload here on return visits.
 */

type Msg = { role: 'user' | 'assistant'; content: string; streaming?: boolean };

const FREE_LIMIT_DEFAULT = 3;

/**
 * Answers render through the house markdown formatter (same as the main
 * chat). Bare /knowledge/<slug> paths the model emits become markdown
 * links first, so sibling-paper pointers are always tappable.
 */
function renderAssistantHtml(text: string): string {
  const cleaned = text
    // The prompt forbids headings and rules; the renderer guarantees it.
    // A heading the model slips through becomes a bold line, a divider
    // disappears — a literal ## or --- never reaches the member.
    .replace(/^#{1,6}\s*(.+)$/gm, '**$1**')
    .replace(/^\s*(?:---+|\*\*\*+)\s*$/gm, '')
    .replace(/(^|[\s(])(\/knowledge\/[a-z0-9][a-z0-9-]*)/g, '$1[$2]($2)');
  return formatMarkdown(cleaned);
}

export default function KnowledgeDiscuss({ slug, signedIn }: { slug: string; signedIn: boolean }) {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [used, setUsed] = useState<number | null>(null);
  const [freeLimit, setFreeLimit] = useState(FREE_LIMIT_DEFAULT);
  const [entitled, setEntitled] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const clickLogged = useRef(false);

  const logOnce = () => {
    if (clickLogged.current) return;
    clickLogged.current = true;
    logKnowledgeEvent('discuss_click', slug, { signedIn });
  };

  // Saved thread + current meter position, so a returning member sees
  // their history and the true remaining count before the first send.
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    (async () => {
      const [{ data: thread }, { data: meterRows }] = await Promise.all([
        supabase.from('knowledge_conversations').select('messages').eq('slug', slug).maybeSingle(),
        supabase.from('knowledge_conversations').select('question_count'),
      ]);
      if (cancelled) return;
      if (thread?.messages) {
        setMessages((thread.messages as Msg[]).map((m) => ({ role: m.role, content: m.content })));
      }
      if (meterRows) {
        setUsed(meterRows.reduce((a, r) => a + (r.question_count || 0), 0));
      }
    })();
    return () => { cancelled = true; };
  }, [slug, signedIn]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [messages]);

  const paywalled = !entitled && used !== null && used >= freeLimit;

  const send = async () => {
    const question = input.trim();
    if (!question || sending || paywalled) return;
    if (!signedIn) { navigate(`/auth?signup=1&next=/knowledge/${slug}`); return; }
    setError('');
    setInput('');
    setSending(true);
    setMessages((prev) => [...prev, { role: 'user', content: question }, { role: 'assistant', content: '', streaming: true }]);
    try {
      const resp = await fetch(DISCUSS_PAPER_ENDPOINT, {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ slug, question, history: messages.slice(-10) }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        if (resp.status === 402 && data.code === 'FREE_LIMIT') {
          setUsed(data.usage?.total_questions ?? freeLimit);
          setFreeLimit(data.usage?.free_limit ?? freeLimit);
          setMessages((prev) => prev.slice(0, -2));
          return;
        }
        throw new Error(data.error || 'Something went wrong');
      }
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let acc = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          try {
            const ev = JSON.parse(raw);
            if (ev.type === 'delta') {
              acc += ev.text;
              setMessages((prev) => prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: acc } : m)));
            }
            if (ev.type === 'done' && ev.usage) {
              if (ev.usage.tier === 'free') {
                setUsed(ev.usage.total_questions);
                setFreeLimit(ev.usage.free_limit ?? FREE_LIMIT_DEFAULT);
              } else {
                setEntitled(true);
              }
            }
            if (ev.type === 'error') throw new Error(ev.error || 'Stream error');
          } catch (e) {
            if (e instanceof Error && e.message !== 'Stream error') continue;
            throw e;
          }
        }
      }
      setMessages((prev) => prev.map((m, i) => (i === prev.length - 1 ? { ...m, streaming: false } : m)));
    } catch (e) {
      // Remove BOTH pending bubbles and restore the question to the input —
      // leaving the user bubble behind doubled the question on retry.
      setMessages((prev) => prev.slice(0, -2));
      setInput(question);
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ marginTop: 14 }}>
      {messages.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 420, overflowY: 'auto', padding: '2px 2px 8px' }}>
          {messages.map((m, i) => (
            <div
              key={i}
              className={m.role === 'assistant' ? 'msg-body assistant' : undefined}
              style={m.role === 'user'
                ? { alignSelf: 'flex-end', maxWidth: '85%', padding: '8px 12px', borderRadius: 10, background: 'var(--surface2, #222)', border: '1px solid var(--border)', fontSize: 13.5, lineHeight: 1.55 }
                : { alignSelf: 'stretch', fontSize: 13.5, lineHeight: 1.6, color: 'var(--text)' }}
            >
              {m.role === 'assistant' ? (
                m.streaming && !m.content
                  ? <span style={{ color: 'var(--text-muted)' }}>thinking…</span>
                  : <div dangerouslySetInnerHTML={{ __html: renderAssistantHtml(m.content) }} />
              ) : m.content}
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}

      {paywalled ? (
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', textAlign: 'center' }}>
          <p style={{ fontSize: 13.5, margin: '0 0 10px', color: 'var(--text)' }}>
            You've used your {freeLimit} free research questions.
          </p>
          <p style={{ fontSize: 12.5, margin: '0 0 12px', color: 'var(--text-dim)' }}>
            Upgrade for unlimited paper discussions with your conversations saved to every study.
          </p>
          <button className="paywall-btn" onClick={() => navigate('/checkout')}>Upgrade Now</button>
        </div>
      ) : (
        <>
          <div className="input-row">
            <textarea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => {
                logOnce();
                if (!signedIn) navigate(`/auth?signup=1&next=/knowledge/${slug}`);
              }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={signedIn ? 'Ask this paper a question…' : 'Ask this paper a question — free account to start'}
              disabled={sending}
            />
            <button className="send-btn" onClick={send} disabled={sending || !input.trim()}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
            </button>
          </div>
          {signedIn && !entitled && used !== null && (
            <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '8px 0 0' }}>
              {Math.max(freeLimit - used, 0)} of {freeLimit} free research questions left — answers come from this paper's verified record.
            </p>
          )}
        </>
      )}
      {error && <p style={{ color: 'var(--accent)', fontSize: 12.5, margin: '8px 0 0' }}>{error}</p>}
    </div>
  );
}
