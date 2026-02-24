import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { CHAT_ENDPOINT, SUMMARIZE_ENDPOINT, supabase } from '../lib/supabase';
import Nav from '../components/Nav';
import InviteBanner from '../components/InviteBanner';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: { title: string; author: string; source: string }[];
  message_id?: string;
  bookmarked?: boolean;
  summary?: string;
  summarizing?: boolean;
  streaming?: boolean;
}

const SUGGESTIONS: Record<string, string[]> = {
  journal: [
    'Paste a workout and ask for scaling and cues',
    'What are the points of performance for the air squat?',
    'How should I scale workouts for beginners?',
    'What is the nutritional prescription?',
    'Explain the three metabolic pathways',
    'What does virtuosity mean in coaching?',
    'How do I improve member retention?',
  ],
  science: [
    'Explain the sliding filament theory of muscle contraction',
    'How does the body regulate blood pressure?',
    'What role does the hypothalamus play in homeostasis?',
    'Describe the physiology of oxygen transport in blood',
    'How do the kidneys regulate fluid balance?',
    'Explain the cardiac cycle and its phases',
  ],
  'strength-science': [
    'How does periodization improve strength gains?',
    'What are the biomechanics of the deadlift?',
    'How does progressive overload work for hypertrophy?',
    'What role does the nervous system play in strength?',
    'How should I program squats for intermediates?',
    'What does the research say about training frequency?',
  ],
};

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
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<'journal' | 'science' | 'strength-science'>('journal');
  const [includeProfile, setIncludeProfile] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [dailyUsage, setDailyUsage] = useState(0);
  const [dailyLimit, setDailyLimit] = useState(75);
  const [tier, setTier] = useState<'free' | 'paid'>('free');
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [freeLimit, setFreeLimit] = useState(3);
  const [tierLoaded, setTierLoaded] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load subscription tier and usage on mount
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
        const { count } = await supabase
          .from('chat_messages')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', session.user.id);
        setTotalQuestions(count || 0);
      }
      setTierLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [messages, isLoading]);

  const isPaywalled = tier === 'free' && totalQuestions >= freeLimit;

  const sendMessage = async (text?: string) => {
    const question = text || input.trim();
    if (!question || isLoading || isPaywalled) return;
    setInput('');
    const userMsg: Message = { role: 'user', content: question };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);

    // Add a placeholder assistant message for streaming
    const assistantIdx = messages.length + 1; // index of the new assistant message
    setMessages(prev => [...prev, { role: 'assistant', content: '', sources: [], streaming: true }]);

    try {
      const resp = await fetch(CHAT_ENDPOINT, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, history: [...messages, userMsg].slice(-10), source_filter: sourceFilter, include_profile: includeProfile }),
      });

      const contentType = resp.headers.get('Content-Type') || '';

      // Handle error responses
      if (!resp.ok) {
        const data = await resp.json();
        if (resp.status === 402 && data.code === 'FREE_LIMIT') {
          setTotalQuestions(freeLimit);
          throw new Error("You've used your 3 free questions");
        }
        throw new Error(data.error || 'Something went wrong');
      }

      // Handle legacy non-streaming JSON response (old edge function)
      if (contentType.includes('application/json')) {
        const data = await resp.json();
        setMessages(prev => prev.map((m, i) =>
          i === assistantIdx
            ? { ...m, content: data.answer, sources: data.sources, message_id: data.message_id, bookmarked: false, streaming: false }
            : m
        ));
        if (data.usage) {
          if (data.usage.tier === 'free') {
            setTotalQuestions(data.usage.total_questions);
            setFreeLimit(data.usage.free_limit);
          } else {
            setDailyUsage(data.usage.daily_questions);
            setDailyLimit(data.usage.daily_limit);
          }
        }
      } else {
        // Handle streaming SSE response
        const reader = resp.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let accumulatedContent = '';
        let sources: { title: string; author: string; source: string }[] = [];

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
              const event = JSON.parse(raw);

              if (event.type === 'sources') {
                sources = event.sources || [];
              }

              if (event.type === 'delta') {
                accumulatedContent += event.text;
                setMessages(prev => prev.map((m, i) =>
                  i === assistantIdx ? { ...m, content: accumulatedContent } : m
                ));
              }

              if (event.type === 'done') {
                setMessages(prev => prev.map((m, i) =>
                  i === assistantIdx
                    ? { ...m, content: accumulatedContent, sources, message_id: event.message_id, bookmarked: false, streaming: false }
                    : m
                ));
                if (event.usage) {
                  if (event.usage.tier === 'free') {
                    setTotalQuestions(event.usage.total_questions);
                    setFreeLimit(event.usage.free_limit);
                  } else {
                    setDailyUsage(event.usage.daily_questions);
                    setDailyLimit(event.usage.daily_limit);
                  }
                }
              }

              if (event.type === 'error') {
                throw new Error(event.error || 'Stream error');
              }
            } catch (parseErr) {
              // Skip unparseable SSE lines unless it's a rethrown error
              if (parseErr instanceof Error && parseErr.message !== 'Stream error') continue;
              throw parseErr;
            }
          }
        }

        // Ensure streaming flag is cleared even if no 'done' event arrived
        setMessages(prev => prev.map((m, i) =>
          i === assistantIdx && m.streaming ? { ...m, sources, streaming: false } : m
        ));
      }

    } catch (err: any) {
      setMessages(prev => {
        // Replace the streaming placeholder with an error, or append one
        const last = prev[prev.length - 1];
        if (last && last.role === 'assistant' && last.streaming) {
          return prev.map((m, i) =>
            i === prev.length - 1 ? { ...m, content: 'Error: ' + err.message, sources: [], streaming: false } : m
          );
        }
        return [...prev, { role: 'assistant', content: 'Error: ' + err.message, sources: [] }];
      });
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

  const summarizeMessage = async (msgId: string, idx: number) => {
    const msg = messages[idx];
    if (!msg || !msgId || msg.summary || msg.summarizing) return;
    setMessages(prev => prev.map((m, i) => i === idx ? { ...m, summarizing: true } : m));
    try {
      const resp = await fetch(SUMMARIZE_ENDPOINT, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_id: msgId }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to summarize');
      setMessages(prev => prev.map((m, i) => i === idx ? { ...m, summary: data.summary, summarizing: false } : m));
    } catch {
      setMessages(prev => prev.map((m, i) => i === idx ? { ...m, summarizing: false } : m));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const activeSuggestions = SUGGESTIONS[sourceFilter];

  const sourceButtons = (['journal', 'science', 'strength-science'] as const).map(s => (
    <button key={s} className={"source-btn " + (sourceFilter === s ? "active" : "")} onClick={() => setSourceFilter(s)}>
      {s === 'journal' ? 'Journal' : s === 'science' ? 'Science' : 'Strength'}
    </button>
  ));

  const usagePill = tier === 'free'
    ? <div className="usage-pill">{totalQuestions}/{freeLimit} free</div>
    : <div className="usage-pill">{dailyUsage}/{dailyLimit}</div>;

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
          {tierLoaded && usagePill}
        </header>

        {messages.length === 0 && !isLoading ? (
          <div className="welcome">
            <div className="welcome-logo">W</div>
            <h2>What do you want to know?</h2>
            <p>{sourceFilter === 'science'
              ? 'Search medical physiology concepts from the Textbook of Medical Physiology.'
              : sourceFilter === 'strength-science'
              ? 'Search strength training science, programming, and biomechanics.'
              : 'Search hundreds of articles on movements, nutrition, coaching methodology, programming, and more.'}</p>
            {!isPaywalled && (
              <div className="suggestions">
                {activeSuggestions.map((s, i) => <button key={i} className="suggestion" onClick={() => sendMessage(s)}>{s}</button>)}
              </div>
            )}
            {isPaywalled && (
              <div className="paywall-card">
                <div className="paywall-icon">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                </div>
                <h3>You've used your 3 free questions</h3>
                <p>Upgrade to get unlimited access to the full coaching knowledge base.</p>
                <button className="paywall-btn" onClick={() => navigate('/checkout')}>Upgrade Now</button>
              </div>
            )}
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
                <div className={"msg-body " + m.role + (m.streaming ? " streaming" : "")} dangerouslySetInnerHTML={{ __html: m.role === 'user' ? m.content.replace(/</g,'&lt;') : formatMarkdown(m.content) }} />

                {/* Summary box — shown when a summary exists */}
                {m.summary && (
                  <div className="summary-box">
                    <div className="summary-header">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="21" y1="10" x2="7" y2="10" /><line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="14" x2="3" y2="14" /><line x1="21" y1="18" x2="7" y2="18" /></svg>
                      <span>Quick Summary</span>
                    </div>
                    <div className="summary-content" dangerouslySetInnerHTML={{ __html: formatMarkdown(m.summary) }} />
                  </div>
                )}

                {/* Summarize button — below answer, above sources, only after streaming completes */}
                {m.role === 'assistant' && m.message_id && !m.streaming && !m.summary && !m.summarizing && (
                  <button className="summarize-action-btn" onClick={() => summarizeMessage(m.message_id!, i)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="21" y1="10" x2="7" y2="10" /><line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="14" x2="3" y2="14" /><line x1="21" y1="18" x2="7" y2="18" /></svg>
                    Summarize
                  </button>
                )}
                {m.summarizing && <span className="summarize-loading">Summarizing...</span>}

                {/* Sources — always last */}
                {m.sources && m.sources.length > 0 && !m.streaming && (
                  <div className="sources-bar">
                    <span className="sources-label">Sources</span>
                    {[...new Set(m.sources.map(s => s.title).filter(Boolean))].map((t, j) => <span key={j} className="source-chip">{t}</span>)}
                  </div>
                )}
              </div>
            ))}
            {isLoading && messages[messages.length - 1]?.role !== 'assistant' && <div className="msg assistant"><div className="msg-header"><span className="msg-avatar">W</span></div><div className="typing"><span /><span /><span /></div></div>}
          </div>
        )}

        {isPaywalled && messages.length > 0 ? (
          <div className="paywall-bar">
            <div className="paywall-bar-inner">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
              <span>You've used your 3 free questions.</span>
              <button className="paywall-btn-sm" onClick={() => navigate('/checkout')}>Upgrade to keep asking</button>
            </div>
          </div>
        ) : (
          <div className="input-area">
            <div className="profile-include-row">
              <button
                type="button"
                className={'profile-include-btn' + (includeProfile ? ' active' : '')}
                onClick={() => setIncludeProfile(v => !v)}
              >
                Include my profile (lifts, skills, conditioning)
              </button>
            </div>
            <div className="input-row">
              <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown} rows={1} placeholder="Ask about movements, nutrition, coaching, programming..." />
              <button className="send-btn" onClick={() => sendMessage()} disabled={isLoading || !input.trim()}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
