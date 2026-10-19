import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DISCUSS_PAPER_ENDPOINT, getAuthHeaders, supabase } from '../lib/supabase';
import { formatMarkdown } from '../lib/formatMarkdown';
import { logKnowledgeEvent } from '../lib/knowledgeEvents';
import { useEntitlements } from '../hooks/useEntitlements';

/**
 * Discuss this paper — the research chat panel on a knowledge entry page —
 * and, with no slug, "Ask the library" on the list page: the server routes
 * the question across the whole catalog and answers from the papers that
 * bear on it, with links.
 *
 * Grounded server-side in verified records (discuss-paper function).
 * Asking is PAID-ONLY: the research_chat entitlement (or admin) asks
 * unlimited questions; signed-in members without it see the upgrade card,
 * signed-out visitors are routed to signup. Threads persist server-side,
 * one per paper plus one library thread (slug "_library"), and reload on
 * paper pages on return visits.
 */

type Msg = { role: 'user' | 'assistant'; content: string; streaming?: boolean };

/**
 * Answers render through the house markdown formatter (same as the main
 * chat). Bare /knowledge/<slug> paths the model emits become markdown
 * links first, so sibling-paper pointers are always tappable.
 */
export function renderAssistantHtml(text: string): string {
  const cleaned = text
    // The prompt forbids headings and rules; the renderer guarantees it.
    // A heading the model slips through becomes a bold line, a divider
    // disappears — a literal ## or --- never reaches the member.
    .replace(/^#{1,6}\s*(.+)$/gm, '**$1**')
    .replace(/^\s*(?:---+|\*\*\*+)\s*$/gm, '')
    // Linkify BARE paths only. A path that is already a markdown link's URL
    // is preceded by "](": wrapping it again nested a link inside a link and
    // the formatter garbled every citation ("Schumann et al. 2022)" with a
    // swallowed paren and no link). Skip those; they're already tappable.
    .replace(/(^|[\s(])(\/knowledge\/[a-z0-9][a-z0-9-]*)/g, (m, pre, path, offset, str) =>
      pre === '(' && str[offset - 1] === ']' ? m : `${pre}[${path}](${path})`);
  return formatMarkdown(cleaned);
}

export default function KnowledgeDiscuss({ slug, signedIn, noHistory = false }: { slug?: string; signedIn: boolean; noHistory?: boolean }) {
  const navigate = useNavigate();
  // No slug = library mode. Library threads persist under the reserved
  // slug '_library' (paper slugs can never start with an underscore).
  const threadSlug = slug ?? '_library';
  const authNext = slug ? `/knowledge/${slug}` : '/knowledge';
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  // Paid-only (founder's call): asking requires the research_chat
  // entitlement or admin. No free questions, no meter. The server is the
  // authority (402 PAID_ONLY); the hook (admin bypass included) decides
  // what this component renders. INVARIANT: never paywall an admin.
  const { hasFeature, loading: entitlementsLoading } = useEntitlements();
  const entitled = hasFeature('research_chat');
  const endRef = useRef<HTMLDivElement>(null);
  const clickLogged = useRef(false);

  const logOnce = () => {
    if (clickLogged.current) return;
    clickLogged.current = true;
    logKnowledgeEvent('discuss_click', slug, { signedIn, library: !slug });
  };

  // Saved thread, so a returning member sees their history on a paper
  // page. noHistory (the library landing page): the box is for ASKING —
  // the saved thread never replays there; reviewing history is My
  // research's job. This session's own Q&A still displays.
  useEffect(() => {
    if (!signedIn || noHistory) return;
    let cancelled = false;
    (async () => {
      const { data: thread } = await supabase
        .from('knowledge_conversations').select('messages').eq('slug', threadSlug).maybeSingle();
      if (cancelled) return;
      if (thread?.messages) {
        setMessages((thread.messages as Msg[]).map((m) => ({ role: m.role, content: m.content })));
      }
    })();
    return () => { cancelled = true; };
  }, [slug, signedIn, noHistory]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [messages]);

  // Asking is locked for everyone without the entitlement: no input to
  // type into and bounce from — a compact card says what members get and
  // offers the one next step (signup for visitors, checkout for free
  // members). Saved threads on paper pages stay readable above it.
  const locked = !entitled && (!signedIn || !entitlementsLoading);

  const send = async () => {
    const question = input.trim();
    if (!question || sending || locked) return;
    setError('');
    setInput('');
    setSending(true);
    setMessages((prev) => [...prev, { role: 'user', content: question }, { role: 'assistant', content: '', streaming: true }]);
    try {
      const resp = await fetch(DISCUSS_PAPER_ENDPOINT, {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ ...(slug ? { slug } : {}), question, history: messages.slice(-10) }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        if (resp.status === 402) {
          // Stale client state — the server is the authority. Roll back the
          // pending bubbles; the entitlements hook will catch up and show
          // the upgrade card.
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
            // 'done' carries usage {tier:"paid"}; nothing to track client-side.
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

      {locked ? (
        // House paywall row (mirrors the main chat's paywall-bar-inner):
        // small accent lock, one line, compact button. No oversized CTA —
        // this sits inside a panel, not on a pricing page.
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, padding: '2px 0' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--accent)', flexShrink: 0 }}>
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span style={{ fontSize: 13.5, color: 'var(--text-dim)', lineHeight: 1.45, flex: 1, minWidth: 170 }}>
            Answers from the research, applied to your training.
          </span>
          <button
            className="paywall-btn-sm"
            onClick={() => {
              logOnce();
              if (!signedIn) navigate(`/auth?signup=1&next=${authNext}`);
              else navigate('/checkout');
            }}
          >
            {signedIn ? 'Upgrade Now' : 'Create Free Account'}
          </button>
        </div>
      ) : (
        <div className="input-row">
          <textarea
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={logOnce}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={slug ? 'Ask this paper a question…' : 'Ask the library anything…'}
            disabled={sending}
          />
          <button className="send-btn" onClick={send} disabled={sending || !input.trim()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
          </button>
        </div>
      )}
      {error && <p style={{ color: 'var(--accent)', fontSize: 12.5, margin: '8px 0 0' }}>{error}</p>}
    </div>
  );
}
