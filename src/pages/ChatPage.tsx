import { useState, useRef, useEffect } from 'react';
import type { Session } from '@supabase/supabase-js';
import { CHAT_ENDPOINT, supabase } from '../lib/supabase';
import Nav from '../components/Nav';
import InviteBanner from '../components/InviteBanner';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: { title: string; author: string; source: string }[];
  message_id?: string;
  bookmarked?: boolean;
}

const SUGGESTIONS = [
  'What are the points of performance for the air squat?',
  'How should I scale workouts for beginners?',
  'What is the nutritional prescription?',
  'Explain the three metabolic pathways',
  'What does virtuosity mean in coaching?',
  'How do I improve member retention?',
];

function formatMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n- /g, '<br>\u2022 ')
    .replace(/\n(\d+)\. /g, '<br>$1. ')
    .replace(/\n/g, '<br>')
    .replace(/^/, '<p>')
    .replace(/$/, '</p>')
    .replace(/<p><\/p>/g, '');
}

export default function ChatPage({ session }: { session: Session }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'journal' | 'physiology'>('all');
  const [navOpen, setNavOpen] = useState(false);
  const [dailyUsage, setDailyUsage] = useState(0);
  const [dailyLimit, setDailyLimit] = useState(75);
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [messages, isLoading]);

  const sendMessage = async (text?: string) => {
    const question = text || input.trim();
    if (!question || isLoading) return;
    setInput('');
    const userMsg: Message = { role: 'user', content: question };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);
    try {
      const resp = await fetch(CHAT_ENDPOINT, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, history: [...messages, userMsg].slice(-10), source_filter: sourceFilter === 'all' ? undefined : sourceFilter }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Something went wrong');
      setMessages(prev => [...prev, { role: 'assistant', content: data.answer, sources: data.sources, message_id: data.message_id, bookmarked: false }]);
      if (data.usage) { setDailyUsage(data.usage.daily_questions); setDailyLimit(data.usage.daily_limit); }
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Error: ' + err.message, sources: [] }]);
    }
    setIsLoading(false);
    inputRef.current?.focus();
  };

  const toggleBookmark = async (msgId: string, idx: number) => {
    const msg = messages[idx];
    if (!msg || !msgId) return;
    if (msg.bookmarked) {
      await supabase.from('bookmarks').delete().eq('user_id', session.user.id).eq('message_id', msgId);
    } else {
      await supabase.from('bookmarks').insert({ user_id: session.user.id, message_id: msgId });
    }
    setMessages(prev => prev.map((m, i) => i === idx ? { ...m, bookmarked: !m.bookmarked } : m));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const sourceButtons = (['all', 'journal', 'physiology'] as const).map(s => (
    <button key={s} className={"source-btn " + (sourceFilter === s ? "active" : "")} onClick={() => setSourceFilter(s)}>
      {s === 'all' ? 'All' : s === 'journal' ? 'Journal' : 'Physiology'}
    </button>
  ));

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <InviteBanner session={session} />
        <header className="chat-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <div className="source-toggle">{sourceButtons}</div>
          <div className="usage-pill">{dailyUsage}/{dailyLimit}</div>
        </header>

        {messages.length === 0 && !isLoading ? (
          <div className="welcome">
            <div className="welcome-logo">W</div>
            <h2>What do you want to know?</h2>
            <p>Search hundreds of articles on movements, nutrition, coaching methodology, programming, and more.</p>
            <div className="suggestions">
              {SUGGESTIONS.map((s, i) => <button key={i} className="suggestion" onClick={() => sendMessage(s)}>{s}</button>)}
            </div>
          </div>
        ) : (
          <div className="messages" ref={messagesRef}>
            {messages.map((m, i) => (
              <div key={i} className={"msg " + m.role}>
                {m.role === 'assistant' && (
                  <div className="msg-header">
                    <span className="msg-avatar">W</span>
                    {m.message_id && <button className={"bookmark-btn " + (m.bookmarked ? "active" : "")} onClick={() => toggleBookmark(m.message_id!, i)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill={m.bookmarked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
                    </button>}
                  </div>
                )}
                <div className={"msg-body " + m.role} dangerouslySetInnerHTML={{ __html: m.role === 'user' ? m.content.replace(/</g,'&lt;') : formatMarkdown(m.content) }} />
                {m.sources && m.sources.length > 0 && (
                  <div className="sources-bar">
                    <span className="sources-label">Sources</span>
                    {[...new Set(m.sources.map(s => s.title).filter(Boolean))].map((t, j) => <span key={j} className="source-chip">{t}</span>)}
                  </div>
                )}
              </div>
            ))}
            {isLoading && <div className="msg assistant"><div className="msg-header"><span className="msg-avatar">W</span></div><div className="typing"><span /><span /><span /></div></div>}
          </div>
        )}

        <div className="input-area">
          <div className="input-row">
            <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown} rows={1} placeholder="Ask about movements, nutrition, coaching, programming..." />
            <button className="send-btn" onClick={() => sendMessage()} disabled={isLoading || !input.trim()}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
