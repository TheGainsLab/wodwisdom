import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';
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

const DAY_COL_NAMES = ['monday', 'mon', 'tuesday', 'tue', 'wednesday', 'wed', 'thursday', 'thu', 'friday', 'fri', 'saturday', 'sat', 'sunday', 'sun'];
const DAY_COL_TO_NUM: Record<string, number> = { monday: 1, mon: 1, tuesday: 2, tue: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, friday: 5, fri: 5, saturday: 6, sat: 6, sunday: 7, sun: 7 };

function parseDayValue(val: unknown): number | null {
  const s = String(val || '').trim().toLowerCase();
  if (DAY_COL_TO_NUM[s] != null) return DAY_COL_TO_NUM[s];
  const n = parseInt(s, 10);
  if (!isNaN(n) && n >= 1 && n <= 7) return n;
  return null;
}

function findHeaderRow(rows: (string | number)[][]): number {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i] || [];
    const cells = row.map(c => String(c || '').trim().toLowerCase());
    const dayCount = cells.filter(c => DAY_COL_NAMES.includes(c)).length;
    if (dayCount >= 2) return i;
  }
  return 0;
}

function parseExcelToWorkouts(arrayBuffer: ArrayBuffer): ParsedWorkout[] {
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 }) as (string | number)[][];

  if (!rows || rows.length < 1) return [];

  const result: ParsedWorkout[] = [];
  const headerRowIdx = findHeaderRow(rows);
  const headerRow = (rows[headerRowIdx] || []).map(c => String(c || '').trim().toLowerCase());
  const dataRows = rows.slice(headerRowIdx + 1);

  const idxWeek = headerRow.findIndex(h => h === 'week' || h === 'wk');
  const idxDay = headerRow.findIndex(h => h === 'day' || h === 'day_num');
  const idxWorkout = headerRow.findIndex(h => ['workout', 'wod', 'exercise', 'exercises'].includes(h));
  const dayCols = headerRow
    .map((h, i) => (DAY_COL_NAMES.includes(h) ? { idx: i, dayNum: DAY_COL_TO_NUM[h] || 1 } : null))
    .filter((x): x is { idx: number; dayNum: number } => x != null)
    .sort((a, b) => a.dayNum - b.dayNum);

  const isPivot = dayCols.length >= 2;
  const pivotWeekCol = headerRow.findIndex(h => h === 'week' || h === 'wk');

  if (isPivot && dayCols.length > 0) {
    const blocks: (string | number)[][][] = [];
    let currentBlock: (string | number)[][] = [];
    for (const row of dataRows) {
      const arr = row || [];
      const hasDataInDayCols = dayCols.some(({ idx }) => {
        const val = arr[idx];
        return val != null && String(val).trim().length > 0;
      });
      if (hasDataInDayCols) {
        currentBlock.push(arr);
      } else if (currentBlock.length > 0) {
        blocks.push(currentBlock);
        currentBlock = [];
      }
    }
    if (currentBlock.length > 0) blocks.push(currentBlock);

    let sortOrder = 0;
    for (let weekIdx = 0; weekIdx < blocks.length; weekIdx++) {
      const block = blocks[weekIdx];
      const firstRow = block[0] as (string | number)[] | undefined;
      const weekNum = pivotWeekCol >= 0 && firstRow?.[pivotWeekCol] != null
        ? parseInt(String(firstRow[pivotWeekCol]), 10) || weekIdx + 1
        : weekIdx + 1;
      for (const { idx, dayNum } of dayCols) {
        const parts = block.map((r: (string | number)[]) => String(r[idx] || '').trim()).filter(Boolean);
        const workoutText = parts.join(' ');
        if (workoutText.length > 0) {
          result.push({ week_num: weekNum, day_num: dayNum, workout_text: workoutText, sort_order: sortOrder++ });
        }
      }
    }
  } else if (idxWeek >= 0 || idxDay >= 0 || idxWorkout >= 0) {
    const w = idxWeek >= 0 ? idxWeek : 0;
    const d = idxDay >= 0 ? idxDay : idxWeek >= 0 ? idxWeek + 1 : 1;
    const txt = idxWorkout >= 0 ? idxWorkout : Math.max(w, d) + 1;
    for (const row of dataRows) {
      const workoutText = String(row[txt] ?? '').trim();
      if (workoutText.length > 0) {
        const weekNum = parseInt(String(row[w] ?? 1), 10) || 1;
        const parsedDay = parseDayValue(row[d]);
        const dayNum = parsedDay ?? 1;
        result.push({ week_num: weekNum, day_num: dayNum, workout_text: workoutText, sort_order: result.length });
      }
    }
  } else {
    for (let i = headerRowIdx + 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const weekNum = parseInt(String(row[0] ?? 1), 10) || 1;
      const parsedDay = parseDayValue(row[1]);
      const dayNum = parsedDay ?? ((i - headerRowIdx) % 7) + 1;
      const workoutText = row.slice(2).map(c => String(c || '').trim()).filter(Boolean).join(' ');
      if (workoutText.length > 0) {
        result.push({ week_num: weekNum, day_num: Math.min(7, Math.max(1, dayNum)), workout_text: workoutText, sort_order: result.length });
      }
    }
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
    const ext = file.name.toLowerCase().split('.').pop() || '';
    const isTxt = ['text/plain', 'text/csv', 'application/csv'].includes(file.type) || ext === 'txt' || ext === 'csv';
    const isDocx = file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === 'docx';
    const isExcel = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'].includes(file.type) || ext === 'xlsx' || ext === 'xls';

    if (!isTxt && !isDocx && !isExcel) {
      setError('Use .txt, .csv, .docx, or .xlsx files.');
      return;
    }

    if (isTxt) {
      const reader = new FileReader();
      reader.onload = () => {
        setPasteText(reader.result as string);
        setError('');
      };
      reader.readAsText(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const buf = reader.result as ArrayBuffer;
      if (isDocx) {
        try {
          const { value } = await mammoth.extractRawText({ arrayBuffer: buf });
          setPasteText(value || '');
          setError('');
        } catch (err) {
          setError('Could not read this Word file. Try copying the text and pasting instead.');
        }
      } else if (isExcel) {
        try {
          const workouts = parseExcelToWorkouts(buf);
          if (workouts.length === 0) {
            setError('Could not find workouts in this Excel file. Expected columns like Week, Day, Workout.');
            return;
          }
          setParsed(workouts);
          setError('');
        } catch (err) {
          setError('Could not read this Excel file.');
        }
      }
    };
    reader.readAsArrayBuffer(file);
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
                  <p>Paste your program below, or drop a .txt, .csv, .docx, or .xlsx file here</p>
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
