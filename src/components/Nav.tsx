import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';

interface NavProps { isOpen: boolean; onClose: () => void; }

export default function Nav({ isOpen, onClose }: NavProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const goTo = (path: string) => { navigate(path); onClose(); };
  const [isAdmin, setIsAdmin] = useState(false);
  const [hasSubscription, setHasSubscription] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

  const isChatActive = location.pathname === '/' || location.pathname === '/history' || location.pathname === '/bookmarks';
  const isTrainingActive = location.pathname.startsWith('/programs') || location.pathname === '/training-log' || location.pathname === '/workout-analysis';
  const isEngineActive = location.pathname.startsWith('/engine');
  const [chatExpanded, setChatExpanded] = useState(isChatActive);
  const [trainingExpanded, setTrainingExpanded] = useState(isTrainingActive);
  const [engineExpanded, setEngineExpanded] = useState(isEngineActive);

  useEffect(() => {
    if (isChatActive) setChatExpanded(true);
    if (isTrainingActive) setTrainingExpanded(true);
    if (isEngineActive) setEngineExpanded(true);
  }, [isChatActive, isTrainingActive]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        supabase.from('profiles').select('role, subscription_status').eq('id', user.id).single()
          .then(({ data }) => {
            if (data?.role === 'admin') setIsAdmin(true);
            if (data?.subscription_status === 'active' || data?.subscription_status === 'canceling' || data?.subscription_status === 'past_due') setHasSubscription(true);
          });
      }
    });
  }, []);

  const openBillingPortal = async () => {
    setPortalLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-portal-session', {
        body: {},
      });
      if (error) {
        alert(error.message || 'Failed to open billing portal');
        return;
      }
      if (data?.error) {
        alert(data.error);
        return;
      }
      if (data?.url) window.location.href = data.url;
    } finally {
      setPortalLoading(false);
      onClose();
    }
  };

  return (
    <>
      {isOpen && <div className="nav-overlay" onClick={onClose} />}
      <nav className={"nav-sidebar " + (isOpen ? "open" : "")}>
        <div className="nav-brand">
          <span className="nav-logo">W</span>
          <span className="nav-title">WodWisdom</span>
        </div>
        <div className="nav-links">
          <button className={"nav-link " + (location.pathname === "/profile" ? "active" : "")} onClick={() => goTo("/profile")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
            Profile
          </button>
          <div className="nav-group">
            <button className={"nav-group-header " + (isChatActive ? "active" : "")} onClick={() => setChatExpanded(!chatExpanded)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
              Chat
              <svg className={"nav-chevron " + (chatExpanded ? "expanded" : "")} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
            </button>
            {chatExpanded && (
              <div className="nav-group-items">
                <button className={"nav-link sub " + (location.pathname === "/" ? "active" : "")} onClick={() => goTo("/")}>
                  <span className="nav-sub-dot" />Chat
                </button>
                <button className={"nav-link sub " + (location.pathname === "/history" ? "active" : "")} onClick={() => goTo("/history")}>
                  <span className="nav-sub-dot" />History
                </button>
                <button className={"nav-link sub " + (location.pathname === "/bookmarks" ? "active" : "")} onClick={() => goTo("/bookmarks")}>
                  <span className="nav-sub-dot" />Bookmarks
                </button>
              </div>
            )}
          </div>
          <div className="nav-group">
            <button className={"nav-group-header " + (isTrainingActive ? "active" : "")} onClick={() => setTrainingExpanded(!trainingExpanded)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
              Training
              <svg className={"nav-chevron " + (trainingExpanded ? "expanded" : "")} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
            </button>
            {trainingExpanded && (
              <div className="nav-group-items">
                <button className={"nav-link sub " + (location.pathname.startsWith("/programs") ? "active" : "")} onClick={() => goTo("/programs")}>
                  <span className="nav-sub-dot" />Programs
                </button>
                <button className={"nav-link sub " + (location.pathname === "/workout-analysis" ? "active" : "")} onClick={() => goTo("/workout-analysis")}>
                  <span className="nav-sub-dot" />Analyze Workout
                </button>
                <button className={"nav-link sub " + (location.pathname === "/training-log" ? "active" : "")} onClick={() => goTo("/training-log")}>
                  <span className="nav-sub-dot" />Training Log
                </button>
              </div>
            )}
          </div>
          <button className={"nav-link " + (location.pathname === "/dashboard" ? "active" : "")} onClick={() => goTo("/dashboard")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
            Dashboard
          </button>
          <div className="nav-group">
            <button className={"nav-group-header " + (isEngineActive ? "active" : "")} onClick={() => setEngineExpanded(!engineExpanded)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
              Engine
              <svg className={"nav-chevron " + (engineExpanded ? "expanded" : "")} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
            </button>
            {engineExpanded && (
              <div className="nav-group-items">
                <button className={"nav-link sub " + (location.pathname === "/engine" || location.pathname === "/engine/dashboard" ? "active" : "")} onClick={() => goTo("/engine")}>
                  <span className="nav-sub-dot" />Dashboard
                </button>
                <button className={"nav-link sub " + (location.pathname === "/engine/analytics" ? "active" : "")} onClick={() => goTo("/engine/analytics")}>
                  <span className="nav-sub-dot" />Analytics
                </button>
              </div>
            )}
          </div>
          {isAdmin && (
            <button className={"nav-link " + (location.pathname === "/admin" ? "active" : "")} onClick={() => goTo("/admin")}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20V10" /><path d="M18 20V4" /><path d="M6 20v-4" /></svg>
              Admin
            </button>
          )}
        </div>
        <div className="nav-footer">
          {hasSubscription ? (
            <button className="nav-link" onClick={openBillingPortal} disabled={portalLoading}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2" /><line x1="1" y1="10" x2="23" y2="10" /></svg>
              {portalLoading ? 'Opening...' : 'Billing'}
            </button>
          ) : (
            <button className={"nav-link " + (location.pathname === "/checkout" ? "active" : "")} onClick={() => goTo("/checkout")}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
              Upgrade
            </button>
          )}
          <button className={"nav-link " + (location.pathname === "/settings" ? "active" : "")} onClick={() => goTo("/settings")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
            Settings
          </button>
          <button className="nav-link logout" onClick={() => supabase.auth.signOut()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
            Sign Out
          </button>
        </div>
      </nav>
    </>
  );
}
