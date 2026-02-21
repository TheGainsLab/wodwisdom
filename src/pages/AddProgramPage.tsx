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

const DAY_COL_NAMES = ['monday', 'mon', 'tuesday', 'tue', 'tues', 'wednesday', 'wed', 'thursday', 'thu', 'thur', 'thurs', 'friday', 'fri', 'saturday', 'sat', 'sunday', 'sun'];
const DAY_COL_TO_NUM: Record<string, number> = { monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6, sunday: 7, sun: 7 };

const WORKOUT_HEADER_RE = /^(for\s+time|amrap\s+\d+|emom\s*\d*|e\d+mom|\d+\s*rounds?\s*(for\s+time)?|\d+\s*rft|every\s+\d+\s+min|death\s+by|tabata|buy\s+in|cash\s+out)/i;
const STRENGTH_RE = /^(?:\d+x\d+\b|@\d+%)/;
const WEEK_LABEL_RE = /week\s*(\d+)|wk\s*(\d+)/i;

function isWorkoutHeader(text: string): boolean {
  return WORKOUT_HEADER_RE.test(text.trim());
}

function isStrengthLine(text: string): boolean {
  return STRENGTH_RE.test(text.trim());
}

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

function findWeekLabelsInCells(rows: (string | number)[][], startRow: number, minDayIdx: number): Map<number, number> {
  const labels = new Map<number, number>();
  for (let r = startRow; r < rows.length; r++) {
    const row = rows[r] || [];
    for (let c = 0; c < minDayIdx; c++) {
      const val = row[c];
      const s = String(val || '').trim();
      const m = s.match(WEEK_LABEL_RE);
      if (m) {
        labels.set(r, parseInt(m[1] || m[2] || '1', 10));
        break;
      }
    }
  }
  return labels;
}

function isRowEmpty(row: (string | number)[], dayIdxs: number[]): boolean {
  return dayIdxs.every(idx => {
    const v = row[idx];
    return v == null || String(v).trim() === '';
  });
}

function detectFormat(rows: (string | number)[][], startRow: number, dayCols: { idx: number }[]): 'A' | 'B' {
  const cols = dayCols.map(d => d.idx);
  let newlineCount = 0;
  let longCount = 0;
  let totalCount = 0;
  for (let r = startRow; r < rows.length; r++) {
    const row = rows[r] || [];
    for (const col of cols) {
      const val = row[col];
      const s = String(val || '').trim();
      if (s.length > 0) {
        totalCount++;
        if (s.includes('\n')) newlineCount++;
        if (s.length > 40) longCount++;
      }
    }
  }
  if (totalCount === 0) return 'A';
  if (newlineCount / totalCount > 0.2) return 'B';
  if (longCount / totalCount > 0.5) return 'B';
  return 'A';
}

function splitIntoBlocks(rows: (string | number)[][], startRow: number, dayCols: { idx: number }[]): { block: (string | number)[][]; startRow: number }[] {
  const cols = dayCols.map(d => d.idx);
  const blocks: { block: (string | number)[][]; startRow: number }[] = [];
  let current: (string | number)[][] = [];
  let blockStart = startRow;
  for (let r = startRow; r < rows.length; r++) {
    const row = rows[r] || [];
    if (isRowEmpty(row, cols)) {
      if (current.length > 0) {
        blocks.push({ block: current, startRow: blockStart });
        current = [];
      }
      blockStart = r + 1;
    } else {
      if (current.length === 0) blockStart = r;
      current.push(row);
    }
  }
  if (current.length > 0) blocks.push({ block: current, startRow: blockStart });
  return blocks;
}

function parseFormatA(
  blocksWithRows: { block: (string | number)[][]; startRow: number }[],
  dayCols: { idx: number; dayNum: number }[],
  weekLabels: Map<number, number>,
  pivotWeekCol: number
): ParsedWorkout[] {
  const result: ParsedWorkout[] = [];
  let sortOrder = 0;
  for (let bi = 0; bi < blocksWithRows.length; bi++) {
    const { block, startRow: blockStartRow } = blocksWithRows[bi];
    let weekNum = bi + 1;
    const lbl = weekLabels.get(blockStartRow);
    if (lbl != null) weekNum = lbl;
    const firstRow = block[0] as (string | number)[] | undefined;
    if (pivotWeekCol >= 0 && firstRow?.[pivotWeekCol] != null) {
      const w = parseInt(String(firstRow[pivotWeekCol]), 10);
      if (!isNaN(w) && w >= 1) weekNum = w;
    }
    for (const { idx, dayNum } of dayCols) {
      const cells = block.map(r => String((r as (string|number)[])[idx] || '').trim()).filter(Boolean);
      if (cells.length === 0) continue;
      const segments: string[][] = [];
      let seg: string[] = [];
      for (const c of cells) {
        if (seg.length > 0 && (isWorkoutHeader(c) || isStrengthLine(c))) {
          segments.push(seg);
          seg = [c];
        } else {
          seg.push(c);
        }
      }
      if (seg.length > 0) segments.push(seg);
      for (const seg of segments) {
        const header = seg[0] || '';
        const movements = seg.slice(1);
        const workoutText = movements.length > 0 ? `${header}: ${movements.join(', ')}` : header;
        result.push({ week_num: weekNum, day_num: dayNum, workout_text: workoutText, sort_order: sortOrder++ });
      }
    }
  }
  return result;
}

function parseFormatB(
  blocksWithRows: { block: (string | number)[][]; startRow: number }[],
  dayCols: { idx: number; dayNum: number }[],
  weekLabels: Map<number, number>,
  pivotWeekCol: number
): ParsedWorkout[] {
  const result: ParsedWorkout[] = [];
  let sortOrder = 0;
  for (let bi = 0; bi < blocksWithRows.length; bi++) {
    const { block, startRow: blockStartRow } = blocksWithRows[bi];
    let weekNum = bi + 1;
    const lbl = weekLabels.get(blockStartRow);
    if (lbl != null) weekNum = lbl;
    const firstRow = block[0] as (string | number)[] | undefined;
    if (pivotWeekCol >= 0 && firstRow?.[pivotWeekCol] != null) {
      const w = parseInt(String(firstRow[pivotWeekCol]), 10);
      if (!isNaN(w) && w >= 1) weekNum = w;
    }
    for (const { idx, dayNum } of dayCols) {
      for (const row of block) {
        const val = (row as (string|number)[])[idx];
        const s = String(val || '').trim();
        if (s.length === 0) continue;
        const lines = s.split(/\n/).map(l => l.trim()).filter(Boolean);
        const workoutText = lines.length > 1 ? `${lines[0]}: ${lines.slice(1).join(', ')}` : (lines[0] || s);
        result.push({ week_num: weekNum, day_num: dayNum, workout_text: workoutText, sort_order: sortOrder++ });
      }
    }
  }
  return result;
}

function parseListLayout(rows: (string | number)[][]): ParsedWorkout[] {
  const result: ParsedWorkout[] = [];
  let headerRow = -1;
  const headers: { week?: number; day?: number; workout?: number } = {};
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const row = rows[r] || [];
    for (let c = 0; c < row.length; c++) {
      const h = String(row[c] || '').trim().toLowerCase();
      if (h === 'week' || h === 'wk') headers.week = c;
      else if (h === 'day' || DAY_COL_NAMES.includes(h)) headers.day = c;
      else if (['workout', 'wod', 'exercise', 'exercises', 'programming', 'training'].includes(h)) headers.workout = c;
    }
    if (headers.workout != null || (headers.week != null && headers.day != null)) {
      headerRow = r;
      break;
    }
  }
  if (headerRow < 0 || headers.workout == null) return result;
  const wCol = headers.week ?? 0;
  const dCol = headers.day ?? 1;
  const tCol = headers.workout;
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const workoutVal = row[tCol];
    const workoutStr = String(workoutVal || '').trim();
    if (workoutStr.length === 0) continue;
    let weekNum = 1;
    if (headers.week != null) {
      const wv = row[wCol];
      const m = String(wv || '').match(WEEK_LABEL_RE);
      if (m) weekNum = parseInt(m[1] || m[2] || '1', 10);
      else weekNum = parseInt(String(wv || 1), 10) || 1;
    }
    let dayNum = 1;
    if (headers.day != null) {
      const dv = row[dCol];
      const parsed = parseDayValue(dv);
      if (parsed != null) dayNum = parsed;
      else {
        const ds = String(dv || '').trim().toLowerCase();
        if (DAY_COL_TO_NUM[ds] != null) dayNum = DAY_COL_TO_NUM[ds];
      }
    }
    const lines = workoutStr.split(/\n/).map(l => l.trim()).filter(Boolean);
    const workoutText = lines.length > 1 ? `${lines[0]}: ${lines.slice(1).join(', ')}` : (lines[0] || workoutStr);
    result.push({ week_num: Math.min(52, Math.max(1, weekNum)), day_num: dayNum, workout_text: workoutText, sort_order: result.length });
  }
  return result;
}

function parseExcelToWorkouts(arrayBuffer: ArrayBuffer): ParsedWorkout[] {
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const allResults: ParsedWorkout[] = [];
  for (let si = 0; si < workbook.SheetNames.length; si++) {
    const sheetName = workbook.SheetNames[si];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 }) as (string | number)[][];
    if (!rows || rows.length < 1) continue;
    const headerRowIdx = findHeaderRow(rows);
    const headerRow = (rows[headerRowIdx] || []).map(c => String(c || '').trim().toLowerCase());
    const dayCols = headerRow
      .map((h, i) => (DAY_COL_NAMES.includes(h) ? { idx: i, dayNum: DAY_COL_TO_NUM[h] || 1 } : null))
      .filter((x): x is { idx: number; dayNum: number } => x != null)
      .sort((a, b) => a.dayNum - b.dayNum);
    const minDayIdx = dayCols.length > 0 ? Math.min(...dayCols.map(d => d.idx)) : 999;
    const pivotWeekCol = headerRow.findIndex(h => h === 'week' || h === 'wk');
    const startRow = headerRowIdx + 1;
    const weekLabels = findWeekLabelsInCells(rows, startRow, minDayIdx);
    const sheetWeekMatch = sheetName.match(WEEK_LABEL_RE);
    const sheetWeek = sheetWeekMatch ? parseInt(sheetWeekMatch[1] || sheetWeekMatch[2] || '1', 10) : null;

    if (dayCols.length >= 2) {
      const blocks = splitIntoBlocks(rows, startRow, dayCols);
      const fmt = detectFormat(rows, startRow, dayCols);
      const sheetResults = fmt === 'A'
        ? parseFormatA(blocks, dayCols, weekLabels, pivotWeekCol)
        : parseFormatB(blocks, dayCols, weekLabels, pivotWeekCol);
      if (sheetWeek != null && !weekLabels.size) {
        for (const r of sheetResults) r.week_num = sheetWeek;
      }
      const baseSort = allResults.length;
      sheetResults.forEach((r, i) => { r.sort_order = baseSort + i; });
      allResults.push(...sheetResults);
    } else {
      const listResults = parseListLayout(rows);
      if (listResults.length > 0) allResults.push(...listResults);
    }
  }
  return allResults.filter(w => w.workout_text.length > 0);
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
