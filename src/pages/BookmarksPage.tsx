import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';

interface Bookmark { id: string; message_id: string; question: string; answer: string; sources: any[]; created_at: string; }

function formatMd(t: string): string {
  return t.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\*(.*?)\*/g,'<em>$1</em>').replace(/\n\n/g,'</p><p>').replace(/\n- /g,'<br>\u2022 ').replace(/\n/g,'<br>').replace(/^/,'<p>').replace(/$/,'</p>');
}

export default function BookmarksPage({ session }: { session: Session }) {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    supabase.from('bookmarks').select('id, message_id, created_at, chat_messages(question, answer, sources)').eq('user_id', session.user.id).order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) setBookmarks(data.map((b: any) => ({ id: b.id, message_id: b.message_id, question: b.chat_messages?.question || '', answer: b.chat_messages?.answer || '', sources: b.chat_messages?.sources || [], created_at: b.created_at })));
        setLoading(false);
      });
  }, []);

  const removeBookmark = async (id: string) => {
    await supabase.from('bookmarks').delete().eq('id', id);
    setBookmarks(prev => prev.filter(b => b.id !== id));
  };

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>Bookmarks</h1>
        </header>
        <div className="page-body">
          {loading ? <div className="page-loading"><div className="loading-pulse" /></div> :
           bookmarks.length === 0 ? <div className="empty-state"><p>No bookmarks yet. Save answers you want to reference later.</p></div> :
           <div className="history-list">
             {bookmarks.map(bm => (
               <div key={bm.id} className={"history-item " + (expanded === bm.id ? "expanded" : "")}>
                 <div className="history-item-header" onClick={() => setExpanded(expanded === bm.id ? null : bm.id)}>
                   <span className="history-question">{bm.question}</span>
                   <button className="bookmark-remove" onClick={e => { e.stopPropagation(); removeBookmark(bm.id); }}>
                     <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
                   </button>
                 </div>
                 {expanded === bm.id && (
                   <div className="history-answer">
                     <div dangerouslySetInnerHTML={{ __html: formatMd(bm.answer) }} />
                     {bm.sources && bm.sources.length > 0 && (
                       <div className="sources-bar">
                         <span className="sources-label">Sources</span>
                         {[...new Set((bm.sources as any[]).map((s: any) => s.title).filter(Boolean))].map((t, j) => <span key={j} className="source-chip">{t}</span>)}
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
