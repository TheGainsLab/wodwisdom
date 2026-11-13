import { useState } from 'react';
import { addCoachNote, deleteCoachNote, describeNote, setCoachNoteHorizon, type CoachNote } from '../lib/coachNotes';

/**
 * "Tell your coach" — the box under a week's days on the program page
 * (founder, 2026-11-12). One field, Save, the saved notes under it with their
 * horizon and a delete. Default horizon: next week. Written weeks are done:
 * a note shapes what gets written next (the Engine's next block within days;
 * AI Programming's next generation). Not on the Engine dashboard — the goal
 * line there is its box.
 */
export default function CoachNotesBox({ notes, programId, weekNum, onChange, compact = false }: {
  notes: CoachNote[];
  programId: string | null;
  weekNum: number | null;
  onChange: (notes: CoachNote[]) => void;
  /** Just the list with deletes (the top-of-page summary). */
  compact?: boolean;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    if (!text.trim() || busy) return;
    setBusy(true); setErr('');
    try {
      const n = await addCoachNote({ text, programId, weekNum, source: 'program_page' });
      onChange([n, ...notes]);
      setText('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save');
    }
    setBusy(false);
  };
  const remove = async (id: string) => {
    onChange(notes.filter((n) => n.id !== id));
    await deleteCoachNote(id).catch(() => {});
  };
  const toggleHorizon = async (n: CoachNote) => {
    const horizon = n.horizon === 'next_week' ? 'until_removed' : 'next_week';
    onChange(notes.map((x) => (x.id === n.id ? { ...x, horizon } : x)));
    await setCoachNoteHorizon(n.id, horizon).catch(() => {});
  };

  const list = notes.length > 0 && (
    <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {notes.map((n) => (
        <li key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text)' }}>
          <span style={{ flex: 1 }}>{n.text}</span>
          <button type="button" onClick={() => toggleHorizon(n)} title="Change how long this applies"
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 999, padding: '1px 8px', fontFamily: 'inherit', fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {describeNote(n)}
          </button>
          <button type="button" onClick={() => remove(n.id)} aria-label="Remove note"
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '0 2px' }}>✕</button>
        </li>
      ))}
    </ul>
  );

  if (compact) return <div>{list}</div>;

  return (
    <div style={{ padding: '12px 14px', borderTop: '1px dashed var(--border)' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Tell your coach about this week</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 8px', lineHeight: 1.5 }}>
        More or less of anything. Read before your next days are written — the Engine&rsquo;s next block within days,
        your next Programming week after this week&rsquo;s last day is logged. Written days don&rsquo;t change; to adjust one now, open it and ask the coach.
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={text}
          maxLength={500}
          placeholder='e.g. "more chest-to-bar pull-ups" · "hotel gym next week, dumbbells only"'
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
          style={{ flex: 1, fontFamily: 'inherit', fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
        />
        <button type="button" className="auth-btn" onClick={save} disabled={busy || !text.trim()} style={{ padding: '8px 14px', fontSize: 13, width: 'auto' }}>
          {busy ? '…' : 'Save'}
        </button>
      </div>
      {err && <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 6 }}>{err}</div>}
      {list}
    </div>
  );
}
