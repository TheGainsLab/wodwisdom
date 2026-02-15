import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';

interface ChatMessage { id: string; question: string; answer: string; sources: any[]; created_at: string; summary?: string; }

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

export default function HistoryPage({ session }: { session: Session }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    supabase.from('chat_messages').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false }).limit(100)
      .then(({ data }) => { if (data) setMessages(data); setLoading(false); });
  }, []);

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>History</h1>
        </header>
        <div className="page-body">
          {loading ? <div className="page-loading"><div className="loading-pulse" /></div> :
           messages.length === 0 ? <div className="empty-state"><p>No conversations yet. Start chatting!</p></div> :
           <div className="history-list">
             {messages.map(msg => (
               <div key={msg.id} className={"history-item " + (expanded === msg.id ? "expanded" : "")} onClick={() => setExpanded(expanded === msg.id ? null : msg.id)}>
                 <div className="history-item-header">
                   <span className="history-question">{msg.question}</span>
                   <span className="history-time">{formatDate(msg.created_at)}</span>
                 </div>
                 {expanded === msg.id && (
                   <div className="history-answer">
                     {msg.summary && (
                       <div className="summary-box">
                         <div className="summary-header">
                           <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="21" y1="10" x2="7" y2="10" /><line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="14" x2="3" y2="14" /><line x1="21" y1="18" x2="7" y2="18" /></svg>
                           <span>Quick Summary</span>
                         </div>
                         <div className="summary-content" dangerouslySetInnerHTML={{ __html: formatMd(msg.summary) }} />
                       </div>
                     )}
                     <div dangerouslySetInnerHTML={{ __html: formatMd(msg.answer) }} />
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
