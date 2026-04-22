import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import GainsLogo from './GainsLogo';

interface NavProps { isOpen: boolean; onClose: () => void; }

export default function Nav({ isOpen, onClose }: NavProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const goTo = (path: string) => { navigate(path); onClose(); };
  const [isAdmin, setIsAdmin] = useState(false);
  const [hasEngine, setHasEngine] = useState(false);
  const [hasProgramming, setHasProgramming] = useState(false);
  const [hasNutrition, setHasNutrition] = useState(false);

  const isChatActive = location.pathname === '/' || location.pathname === '/history' || location.pathname === '/bookmarks';
  const isEngineActive = location.pathname.startsWith('/engine');
  const isTrainingActive = location.pathname.startsWith('/programs') || location.pathname === '/training-log' || location.pathname.startsWith('/ailog') || location.pathname === '/workout-review' || location.pathname.startsWith('/workout');
  const isNutritionActive = location.pathname.startsWith('/nutrition');
  const [chatExpanded, setChatExpanded] = useState(isChatActive);
  const [engineExpanded, setEngineExpanded] = useState(isEngineActive);
  const [trainingExpanded, setTrainingExpanded] = useState(isTrainingActive);
  const [nutritionExpanded, setNutritionExpanded] = useState(isNutritionActive);

  useEffect(() => {
    if (isChatActive) setChatExpanded(true);
    if (isEngineActive) setEngineExpanded(true);
    if (isTrainingActive) setTrainingExpanded(true);
    if (isNutritionActive) setNutritionExpanded(true);
  }, [isChatActive, isEngineActive, isTrainingActive, isNutritionActive]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        // Check admin role
        supabase.from('profiles').select('role').eq('id', user.id).single()
          .then(({ data }) => {
            if (data?.role === 'admin') setIsAdmin(true);
          });
        // Check if user has any entitlements (i.e. is a subscriber)
        supabase.from('user_entitlements').select('id, feature')
          .eq('user_id', user.id)
          .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString())
          .then(({ data }) => {
            if (!data) return;
            if (data.some(e => e.feature === 'engine')) setHasEngine(true);
            if (data.some(e => e.feature === 'programming')) setHasProgramming(true);
            if (data.some(e => e.feature === 'nutrition')) setHasNutrition(true);
          });
      }
    });
  }, []);


  return (
    <>
      {isOpen && <div className="nav-overlay" onClick={onClose} />}
      <nav className={"nav-sidebar " + (isOpen ? "open" : "")}>
        <div className="nav-brand">
          <GainsLogo className="nav-title" />
        </div>
        <div className="nav-links">
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
            {(hasEngine || isAdmin) ? (
              <>
                <button className={"nav-group-header " + (isEngineActive ? "active" : "")} onClick={() => setEngineExpanded(!engineExpanded)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2c1 3 2.5 3.5 3.5 4.5A5 5 0 0 1 17 10c0 2.76-2.24 5-5 5s-5-2.24-5-5c0-1.33.52-2.54 1.37-3.44C9.37 5.56 11 5 12 2z" /><path d="M12 15v7" /><path d="M8 22h8" /></svg>
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
              </>
            ) : (
              <button className={"nav-group-header " + (isEngineActive ? "active" : "")} onClick={() => goTo("/engine")}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2c1 3 2.5 3.5 3.5 4.5A5 5 0 0 1 17 10c0 2.76-2.24 5-5 5s-5-2.24-5-5c0-1.33.52-2.54 1.37-3.44C9.37 5.56 11 5 12 2z" /><path d="M12 15v7" /><path d="M8 22h8" /></svg>
                Engine
              </button>
            )}
          </div>
          <div className="nav-group">
            {(hasProgramming || isAdmin) ? (
              <>
                <button className={"nav-group-header " + (isTrainingActive ? "active" : "")} onClick={() => setTrainingExpanded(!trainingExpanded)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
                  Training
                  <svg className={"nav-chevron " + (trainingExpanded ? "expanded" : "")} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
                </button>
                {trainingExpanded && (
                  <div className="nav-group-items">
                    <button className={"nav-link sub " + (location.pathname.startsWith("/programs") ? "active" : "")} onClick={() => goTo("/programs")}>
                      <span className="nav-sub-dot" />My Programs
                    </button>
                    <button className={"nav-link sub " + (location.pathname === "/training-log" ? "active" : "")} onClick={() => goTo("/training-log")}>
                      <span className="nav-sub-dot" />Training Log
                    </button>
                  </div>
                )}
              </>
            ) : (
              <button className={"nav-group-header " + (isTrainingActive ? "active" : "")} onClick={() => goTo("/programs")}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
                Training
              </button>
            )}
          </div>
          <div className="nav-group">
            {(hasNutrition || isAdmin) ? (
              <>
                <button className={"nav-group-header " + (isNutritionActive ? "active" : "")} onClick={() => setNutritionExpanded(!nutritionExpanded)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 8c0-5-5-5-5-5s-5 0-5 5c0 3.5 2.5 6 5 8 2.5-2 5-4.5 5-8z" /><path d="M12 4v16" /></svg>
                  Nutrition
                  <svg className={"nav-chevron " + (nutritionExpanded ? "expanded" : "")} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
                </button>
                {nutritionExpanded && (
                  <div className="nav-group-items">
                    <button className={"nav-link sub " + (location.pathname === "/nutrition" ? "active" : "")} onClick={() => goTo("/nutrition")}>
                      <span className="nav-sub-dot" />Dashboard
                    </button>
                    <button className={"nav-link sub " + (location.pathname === "/nutrition/calendar" ? "active" : "")} onClick={() => goTo("/nutrition/calendar")}>
                      <span className="nav-sub-dot" />Calendar
                    </button>
                  </div>
                )}
              </>
            ) : (
              <button className={"nav-group-header " + (isNutritionActive ? "active" : "")} onClick={() => goTo("/nutrition")}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 8c0-5-5-5-5-5s-5 0-5 5c0 3.5 2.5 6 5 8 2.5-2 5-4.5 5-8z" /><path d="M12 4v16" /></svg>
                Nutrition
              </button>
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
          <button className={"nav-link " + (location.pathname === "/profile" ? "active" : "")} onClick={() => goTo("/profile")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
            Profile
          </button>
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
