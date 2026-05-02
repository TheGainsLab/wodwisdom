import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useDebounce } from '../hooks/useDebounce';
import Nav from '../components/Nav';

interface ChatMessage { id: string; question: string; answer: string; sources: any[]; context_type?: string | null; created_at: string; summary?: string; bookmarked?: boolean; }

function formatMd(t: string): string {
  return t.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\*(.*?)\*/g,'<em>$1</em>').replace(/\n\n/g,'</p><p>').replace(/\n- /g,'<br>\u2022 ').replace(/\n/g,'<br>').replace(/^/,'<p>').replace(/$/,'</p>');
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return mins + 'm ago';
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return hours + 'h ago';
  const days = Math.floor(diff / 86400000);
  if (days < 7) return days + 'd ago';
  return d.toLocaleDateString();
}

function getMatchType(msg: ChatMessage, term: string): 'question' | 'answer' | 'both' | null {
  if (!term.trim()) return null;
  const t = term.toLowerCase();
  const inQ = msg.question.toLowerCase().includes(t);
  const inA = msg.answer.toLowerCase().includes(t);
  if (inQ && inA) return 'both';
  if (inQ) return 'question';
  if (inA) return 'answer';
  return null;
}

export default function HistoryPage({ session }: { session: Session }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<ChatMessage[] | null>(null);
  const [searching, setSearching] = useState(false);
  const debouncedSearch = useDebounce(searchTerm, 300);

  useEffect(() => {
    supabase.from('chat_messages').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false }).limit(100)
      .then(({ data }) => { if (data) setMessages(data); setLoading(false); });
  }, []);

  // Hydrate bookmark state for any messages we know about. Re-runs when the
  // message id set changes (initial load, search results swap in/out).
  useEffect(() => {
    const ids = [
      ...messages.map(m => m.id),
      ...(searchResults ?? []).map(m => m.id),
    ];
    const unique = Array.from(new Set(ids));
    if (unique.length === 0) return;
    let cancelled = false;
    supabase
      .from('bookmarks')
      .select('message_id')
      .eq('user_id', session.user.id)
      .in('message_id', unique)
      .then(({ data }) => {
        if (cancelled || !data) return;
        const bookmarked = new Set((data as { message_id: string }[]).map(b => b.message_id));
        setMessages(prev => prev.map(m => bookmarked.has(m.id) === !!m.bookmarked ? m : { ...m, bookmarked: bookmarked.has(m.id) }));
        setSearchResults(prev => prev === null ? prev : prev.map(m => bookmarked.has(m.id) === !!m.bookmarked ? m : { ...m, bookmarked: bookmarked.has(m.id) }));
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.map(m => m.id).join(','), (searchResults ?? []).map(m => m.id).join(',')]);

  const toggleBookmark = async (msgId: string, currentlyBookmarked: boolean) => {
    // Optimistic update across both lists
    const apply = (list: ChatMessage[]) =>
      list.map(m => m.id === msgId ? { ...m, bookmarked: !currentlyBookmarked } : m);
    setMessages(prev => apply(prev));
    setSearchResults(prev => prev === null ? prev : apply(prev));
    try {
      if (currentlyBookmarked) {
        await supabase.from('bookmarks').delete().eq('user_id', session.user.id).eq('message_id', msgId);
      } else {
        await supabase.from('bookmarks').insert({ user_id: session.user.id, message_id: msgId });
      }
    } catch {
      // Roll back on failure
      const rollback = (list: ChatMessage[]) =>
        list.map(m => m.id === msgId ? { ...m, bookmarked: currentlyBookmarked } : m);
      setMessages(prev => rollback(prev));
      setSearchResults(prev => prev === null ? prev : rollback(prev));
    }
  };

  useEffect(() => {
    if (!debouncedSearch.trim()) {
      setSearchResults(null);
      setSearching(false);
      return;
    }

    setSearching(true);
    const term = debouncedSearch.trim().replace(/%/g, '\\%').replace(/_/g, '\\_');

    supabase
      .from('chat_messages')
      .select('*')
      .eq('user_id', session.user.id)
      .or(`question.ilike.%${term}%,answer.ilike.%${term}%`)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        setSearchResults(data || []);
        setSearching(false);
      });
  }, [debouncedSearch]);

  useEffect(() => {
    setExpanded(null);
  }, [debouncedSearch]);

  const displayMessages = searchResults !== null ? searchResults : messages;

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>History</h1>
          <div className="history-search-wrap">
            <svg className="history-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              className="history-search-input"
              type="text"
              placeholder="Search questions & answers..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button className="history-search-clear" onClick={() => setSearchTerm('')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        </header>
        <div className="page-body">
          {searching && <div className="search-result-count">Searching...</div>}
          {searchResults !== null && !searching && (
            <div className="search-result-count">
              {searchResults.length === 0
                ? `No results for \u201c${debouncedSearch}\u201d`
                : searchResults.length === 50
                  ? 'Showing first 50 results'
                  : `${searchResults.length} result${searchResults.length === 1 ? '' : 's'}`
              }
            </div>
          )}
          {loading ? <div className="page-loading"><div className="loading-pulse" /></div> :
           displayMessages.length === 0 && !searchTerm ? <div className="empty-state"><p>No conversations yet. Start chatting!</p></div> :
           displayMessages.length === 0 && searchTerm && !searching ? (
             <div className="empty-state">
               <p>No results for &ldquo;{debouncedSearch}&rdquo;</p>
               <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Try different keywords</p>
             </div>
           ) :
           <div className="history-list">
             {displayMessages.map(msg => (
               <div key={msg.id} className={"history-item " + (expanded === msg.id ? "expanded" : "")} onClick={() => setExpanded(expanded === msg.id ? null : msg.id)}>
                 <div className="history-item-header">
                   {msg.context_type === 'workout' && (
                     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" style={{ flexShrink: 0 }}><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /></svg>
                   )}
                   <span className="history-question">{msg.question}</span>
                   {debouncedSearch.trim() && (() => {
                     const match = getMatchType(msg, debouncedSearch);
                     return match ? (
                       <span className="history-match-badge">
                         {match === 'both' ? 'Q & A' : match === 'question' ? 'Question' : 'Answer'}
                       </span>
                     ) : null;
                   })()}
                   <span className="history-time">{formatDate(msg.created_at)}</span>
                   <button
                     className={"bookmark-btn " + (msg.bookmarked ? "active" : "")}
                     onClick={(e) => { e.stopPropagation(); toggleBookmark(msg.id, !!msg.bookmarked); }}
                     aria-label={msg.bookmarked ? 'Remove bookmark' : 'Save to bookmarks'}
                     title={msg.bookmarked ? 'Bookmarked' : 'Save'}
                     style={{
                       background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                       display: 'inline-flex', color: msg.bookmarked ? 'var(--accent)' : 'var(--text-dim)',
                     }}
                   >
                     <svg width="14" height="14" viewBox="0 0 24 24" fill={msg.bookmarked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
                   </button>
                 </div>
                 {expanded === msg.id && (
                   <div className="history-answer">
                     <div dangerouslySetInnerHTML={{ __html: formatMd(msg.answer) }} />
                     {msg.summary && (
                       <div className="summary-box">
                         <div className="summary-header">
                           <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="21" y1="10" x2="7" y2="10" /><line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="14" x2="3" y2="14" /><line x1="21" y1="18" x2="7" y2="18" /></svg>
                           <span>Quick Summary</span>
                         </div>
                         <div className="summary-content" dangerouslySetInnerHTML={{ __html: formatMd(msg.summary) }} />
                       </div>
                     )}
                     {msg.sources && msg.sources.length > 0 && (
                       <div className="sources-bar">
                         <span className="sources-label">Sources</span>
                         {[...new Set((msg.sources as any[]).map((s: any) => s.title).filter(Boolean))].map((t, j) => <span key={j} className="source-chip">{t}</span>)}
                       </div>
                     )}
                   </div>
                 )}
               </div>
             ))}
           </div>}
        </div>
      </div>
    </div>
  );
}
