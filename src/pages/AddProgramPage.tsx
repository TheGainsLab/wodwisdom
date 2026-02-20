import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';
import InviteBanner from '../components/InviteBanner';

interface ParsedWorkout {
  week_num: number;
  day_num: number;
  workout_text: string;
  sort_order: number;
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_ABBREV = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEK_REGEX = /week\s*(\d+)/i;

function parseProgramText(text: string): ParsedWorkout[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split(/\n/).map(l => l.trim()).filter(Boolean);
  const result: ParsedWorkout[] = [];
  let currentWeek = 1;
  let currentDay = 1;
  let sortOrder = 0;

  for (const line of lines) {
    const wkMatch = line.match(WEEK_REGEX);
    if (wkMatch) {
      currentWeek = parseInt(wkMatch[1], 10) || 1;
      continue;
    }
    let dayNum = currentDay;
    const lower = line.toLowerCase();
    for (let i = 0; i < DAY_NAMES.length; i++) {
      if (lower.startsWith(DAY_NAMES[i].toLowerCase() + ':') || lower.startsWith(DAY_ABBREV[i].toLowerCase() + ':')) {
        dayNum = i + 1;
        break;
      }
      if (lower.startsWith(DAY_NAMES[i].toLowerCase() + ' ') || lower.startsWith(DAY_ABBREV[i].toLowerCase() + ' ')) {
        dayNum = i + 1;
        break;
      }
    }
    const workoutText = line.replace(/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\s*:?\s*/i, '').trim();
    if (workoutText.length > 0) {
      result.push({ week_num: currentWeek, day_num: dayNum, workout_text: workoutText, sort_order: sortOrder++ });
      currentDay = dayNum;
    }
  }

  if (result.length === 0) {
    const blocks = text.split(/\n\n+/).map(b => b.trim()).filter(b => b.length > 5);
    blocks.forEach((block, i) => {
      result.push({ week_num: Math.floor(i / 7) + 1, day_num: (i % 7) + 1, workout_text: block, sort_order: i });
    });
  }

  return result;
}

export default function AddProgramPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [pasteText, setPasteText] = useState('');
  const [programName, setProgramName] = useState('');
  const [parsed, setParsed] = useState<ParsedWorkout[] | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [navOpen, setNavOpen] = useState(false);

  const parseInput = useCallback(() => {
    const text = pasteText.trim();
    if (!text) {
      setError('Paste or drop some workout text first');
      return;
    }
    setError('');
    const workouts = parseProgramText(text);
    if (workouts.length === 0) {
      setError('Could not parse any workouts. Try separating days with blank lines or "Week 1", "Monday:", etc.');
      setParsed(null);
      return;
    }
    setParsed(workouts);
  }, [pasteText]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (!['text/plain', 'text/csv', 'application/csv'].includes(file.type) && !file.name.endsWith('.txt') && !file.name.endsWith('.csv')) {
      setError('Use .txt or .csv files. Excel coming soon.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      setPasteText(content);
      setError('');
    };
    reader.readAsText(file);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragOver(false), []);

  const saveProgram = async () => {
    if (!parsed || parsed.length === 0) return;
    setSaving(true);
    setError('');
    try {
      const { data: prog, error: progErr } = await supabase
        .from('programs')
        .insert({ user_id: session.user.id, name: programName.trim() || 'Untitled Program' })
        .select('id')
        .single();
      if (progErr) throw progErr;
      const rows = parsed.map((w, i) => ({
        program_id: prog.id,
        week_num: w.week_num,
        day_num: w.day_num,
        workout_text: w.workout_text,
        sort_order: i,
      }));
      const { error: wkErr } = await supabase.from('program_workouts').insert(rows);
      if (wkErr) throw wkErr;
      navigate(`/programs/${prog.id}`);
    } catch (err: any) {
      setError(err?.message || 'Failed to save program');
    } finally {
      setSaving(false);
    }
  };

  const updateWorkout = (idx: number, field: 'week_num' | 'day_num' | 'workout_text', value: number | string) => {
    if (!parsed) return;
    setParsed(prev => prev!.map((w, i) => i === idx ? { ...w, [field]: value } : w));
  };

  const removeWorkout = (idx: number) => {
    if (!parsed) return;
    setParsed(prev => prev!.filter((_, i) => i !== idx));
  };

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <InviteBanner session={session} />
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>Add program</h1>
        </header>
        <div className="page-body">
          <div className="programs-add-wrap">
            {parsed === null ? (
              <>
                <div
                  className={'program-paste-zone' + (isDragOver ? ' drag-over' : '')}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                >
                  <p>Paste your program below, or drop a .txt or .csv file here</p>
                  <textarea
                    placeholder="Week 1&#10;Monday: 5 RFT 20 WB, 10 T2B, 5 PC 135/95&#10;Tuesday: Back squat 5x5 @ 80%&#10;Wednesday: Helen&#10;&#10;Week 2&#10;..."
                    value={pasteText}
                    onChange={e => setPasteText(e.target.value)}
                    rows={12}
                  />
                </div>
                <div className="program-actions">
                  <input
                    type="text"
                    className="program-name-input"
                    placeholder="Program name (optional)"
                    value={programName}
                    onChange={e => setProgramName(e.target.value)}
                  />
                  <button className="auth-btn" onClick={parseInput} disabled={!pasteText.trim()}>
                    Parse & preview
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="program-preview-header">
                  <h2>Preview – {parsed.length} workout{parsed.length !== 1 ? 's' : ''} parsed</h2>
                  <button type="button" className="link-btn" onClick={() => { setParsed(null); setError(''); }}>
                    Change input
                  </button>
                </div>
                <div className="program-preview-table-wrap">
                  <table className="program-preview-table">
                    <thead>
                      <tr>
                        <th>Week</th>
                        <th>Day</th>
                        <th>Workout</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.map((w, i) => (
                        <tr key={i}>
                          <td>
                            <input
                              type="number"
                              min={1}
                              value={w.week_num}
                              onChange={e => updateWorkout(i, 'week_num', parseInt(e.target.value, 10) || 1)}
                              className="program-edit-num"
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min={1}
                              max={7}
                              value={w.day_num}
                              onChange={e => updateWorkout(i, 'day_num', parseInt(e.target.value, 10) || 1)}
                              className="program-edit-num"
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              value={w.workout_text}
                              onChange={e => updateWorkout(i, 'workout_text', e.target.value)}
                              className="program-edit-text"
                            />
                          </td>
                          <td>
                            <button type="button" className="program-remove-btn" onClick={() => removeWorkout(i)}>Remove</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="program-actions">
                  <input
                    type="text"
                    className="program-name-input"
                    placeholder="Program name"
                    value={programName}
                    onChange={e => setProgramName(e.target.value)}
                  />
                  <button className="auth-btn" onClick={saveProgram} disabled={saving}>
                    {saving ? 'Saving...' : 'Save program'}
                  </button>
                </div>
              </>
            )}
            {error && <div className="error-msg" style={{ marginTop: 12 }}>{error}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
