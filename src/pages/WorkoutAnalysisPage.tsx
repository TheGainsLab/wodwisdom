import { useEffect, useState, useRef } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';
import InviteBanner from '../components/InviteBanner';

interface Analysis {
  warm_up?: string;
  movement_tips?: string;
  scaling?: string;
  pacing?: string;
  stimulus?: string;
}

interface SavedAnalysis {
  id: string;
  workout_text: string;
  analysis: Analysis;
  created_at: string;
}

const SECTION_LABELS: { key: keyof Analysis; label: string }[] = [
  { key: 'stimulus', label: 'Stimulus & Intent' },
  { key: 'warm_up', label: 'Warm-up' },
  { key: 'movement_tips', label: 'Movement Tips & Cues' },
  { key: 'scaling', label: 'Scaling Options' },
  { key: 'pacing', label: 'Pacing & Strategy' },
];

export default function WorkoutAnalysisPage({ session }: { session: Session }) {
  const [navOpen, setNavOpen] = useState(false);
  const [workoutText, setWorkoutText] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [currentAnalysis, setCurrentAnalysis] = useState<SavedAnalysis | null>(null);
  const [pastAnalyses, setPastAnalyses] = useState<SavedAnalysis[]>([]);
  const [expandedPast, setExpandedPast] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    loadPastAnalyses();
  }, [session.user.id]);

  const loadPastAnalyses = async () => {
    const { data } = await supabase
      .from('workout_analyses')
      .select('id, workout_text, analysis, created_at')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(20);
    setPastAnalyses(data || []);
  };

  const handleAnalyze = async () => {
    const trimmed = workoutText.trim();
    if (!trimmed || trimmed.length < 10) {
      setError('Paste a workout to analyze (at least a few lines).');
      return;
    }
    setError('');
    setAnalyzing(true);
    setCurrentAnalysis(null);

    const { data, error: fnErr } = await supabase.functions.invoke('analyze-workout', {
      body: { workout_text: trimmed },
    });

    if (fnErr || data?.error) {
      setError(data?.error || fnErr?.message || 'Analysis failed');
      setAnalyzing(false);
      return;
    }

    setCurrentAnalysis(data);
    setWorkoutText('');
    setAnalyzing(false);
    loadPastAnalyses();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && (file.type === 'text/plain' || file.name.endsWith('.txt'))) {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') setWorkoutText(reader.result);
      };
      reader.readAsText(file);
    }
  };

  const handleDelete = async (id: string) => {
    await supabase.from('workout_analyses').delete().eq('id', id).eq('user_id', session.user.id);
    setPastAnalyses(prev => prev.filter(a => a.id !== id));
    if (currentAnalysis?.id === id) setCurrentAnalysis(null);
    if (expandedPast === id) setExpandedPast(null);
  };

  const formatDate = (s: string) => {
    const d = new Date(s);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const truncate = (s: string, n: number) => s.length > n ? s.slice(0, n) + '...' : s;

  const renderAnalysis = (analysis: Analysis) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {SECTION_LABELS.map(({ key, label }) => {
        const content = analysis[key];
        if (!content) return null;
        return (
          <div key={key} style={{ background: 'var(--surface2)', borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--accent)', marginBottom: 6 }}>
              {label}
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>
              {content}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <InviteBanner session={session} />
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>Analyze Workout</h1>
        </header>
        <div className="page-body">
          <div style={{ maxWidth: 700, margin: '0 auto' }}>
            {/* Input area */}
            <div
              style={{
                border: dragOver ? '2px dashed var(--accent)' : '2px dashed var(--surface2)',
                borderRadius: 8,
                padding: 4,
                transition: 'border-color 0.15s',
              }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <textarea
                ref={textareaRef}
                value={workoutText}
                onChange={(e) => setWorkoutText(e.target.value)}
                placeholder="Paste a workout here, or drag and drop a .txt file..."
                rows={6}
                style={{
                  width: '100%',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  border: 'none',
                  borderRadius: 6,
                  padding: 14,
                  fontSize: 14,
                  fontFamily: 'inherit',
                  resize: 'vertical',
                  outline: 'none',
                }}
              />
            </div>

            {error && (
              <div style={{ color: '#e74c3c', fontSize: 13, marginTop: 8 }}>{error}</div>
            )}

            <button
              className="auth-btn"
              onClick={handleAnalyze}
              disabled={analyzing || !workoutText.trim()}
              style={{ marginTop: 12, width: '100%', fontSize: 14 }}
            >
              {analyzing ? 'Analyzing...' : 'Analyze'}
            </button>

            {/* Current analysis result */}
            {currentAnalysis && (
              <div style={{ marginTop: 24 }}>
                <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 12, fontStyle: 'italic', whiteSpace: 'pre-wrap' }}>
                  {currentAnalysis.workout_text}
                </div>
                {renderAnalysis(currentAnalysis.analysis)}
              </div>
            )}

            {/* Past analyses */}
            {pastAnalyses.length > 0 && (
              <div style={{ marginTop: 32 }}>
                <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Past Analyses</h2>
                <div className="history-list">
                  {pastAnalyses.map(a => (
                    <div key={a.id} className="history-item" style={{ cursor: 'pointer' }} onClick={() => setExpandedPast(expandedPast === a.id ? null : a.id)}>
                      <div className="history-item-header">
                        <span className="history-question">{truncate(a.workout_text, 80)}</span>
                        <span className="history-time">{formatDate(a.created_at)}</span>
                        <div className="program-list-actions" onClick={e => e.stopPropagation()}>
                          <button
                            type="button"
                            className="program-list-btn program-list-btn-delete"
                            onClick={() => handleDelete(a.id)}
                            title="Delete"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
                          </button>
                        </div>
                      </div>
                      {expandedPast === a.id && (
                        <div style={{ padding: '12px 18px 16px' }}>
                          <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 12, whiteSpace: 'pre-wrap', fontStyle: 'italic' }}>
                            {a.workout_text}
                          </div>
                          {renderAnalysis(a.analysis)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
