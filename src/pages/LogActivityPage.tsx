/**
 * LogActivityPage — log training done outside your programs.
 *
 * v2 flow: pick a date, describe the session in plain words AND/OR attach a
 * photo (erg display, watch summary, whiteboard) → AI parses it into one or
 * more typed cards (conditioning / metcon / strength / skills / other, the
 * block-aligned taxonomy) → confirm (or fix) each card → save. A manual-entry
 * path skips the parse entirely. Saved activities land on the Training Log
 * calendar, inform the AI Coach immediately, feed the AI sequencer's
 * other-load fingerprint, and are considered when the next month's program
 * generates. They never change Engine pacing.
 *
 * AI Programming + Year of the Engine tiers (and admins) — a coach
 * capability, not a program feature. The entry primitive of the long-term
 * AI Logger platform — keep it self-contained.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import Nav from '../components/Nav';
import { useEntitlements } from '../hooks/useEntitlements';
import {
  parseActivity,
  saveActivity,
  listActivities,
  deleteActivity,
  emptyParsedActivity,
  WORKOUT_TYPES,
  type ParsedActivity,
  type AthleteActivity,
  type ActivityImage,
  type WorkoutType,
} from '../lib/activitiesService';
import { Loader2, Check, Trash2, ChevronLeft, Camera, X } from 'lucide-react';

function localDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const TYPE_LABELS: Record<WorkoutType, string> = {
  conditioning: 'Conditioning',
  metcon: 'Metcon',
  strength: 'Strength',
  skills: 'Skills',
  other: 'Other',
};

/** Downscale a photo to ≤1600px JPEG before upload — phone photos routinely
 *  exceed the 5MB API image cap, and full resolution buys nothing for
 *  reading numbers off a screen. */
async function fileToActivityImage(file: File): Promise<{ image: ActivityImage; previewUrl: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = dataUrl;
  });
  const MAX = 1600;
  const scale = Math.min(1, MAX / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  const jpeg = canvas.toDataURL('image/jpeg', 0.85);
  return {
    image: { base64: jpeg.split(',')[1], type: 'jpeg' },
    previewUrl: jpeg,
  };
}

const inputStyle: React.CSSProperties = {
  display: 'block', width: '100%', marginTop: 4, padding: '6px 8px', borderRadius: 6,
  border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)',
};
const labelStyle: React.CSSProperties = { fontSize: 12, color: 'var(--text-dim)' };

export default function LogActivityPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [navOpen, setNavOpen] = useState(false);
  const { hasFeature, isAdmin, loading: entLoading } = useEntitlements(session.user.id);

  const [date, setDate] = useState(params.get('date') ?? localDate());
  const [text, setText] = useState('');
  const [image, setImage] = useState<ActivityImage | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [cards, setCards] = useState<ParsedActivity[] | null>(null);
  const [savingIdx, setSavingIdx] = useState<number | null>(null);
  // The image uploads with the FIRST saved card only — one file, one upload;
  // sibling cards from the same parse share the entry's raw_text provenance.
  const imageConsumedRef = useRef(false);
  const [error, setError] = useState('');
  const [recent, setRecent] = useState<AthleteActivity[]>([]);
  const [savedFlash, setSavedFlash] = useState(false);

  // Coach capability, not a program feature: Programming AND Engine tiers.
  const allowed = isAdmin || hasFeature('programming') || hasFeature('engine');

  const loadRecent = () => {
    listActivities(15).then(setRecent).catch(() => {});
  };
  useEffect(() => { if (allowed) loadRecent(); }, [allowed]);

  const pickPhoto = async (file: File | null) => {
    if (!file) return;
    setError('');
    try {
      const { image: img, previewUrl } = await fileToActivityImage(file);
      setImage(img);
      setImagePreview(previewUrl);
      setCards(null);
    } catch {
      setError('Could not read that photo — try another one.');
    }
  };

  const clearPhoto = () => {
    setImage(null);
    setImagePreview(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const doParse = async () => {
    setError('');
    setParsing(true);
    imageConsumedRef.current = false;
    try {
      setCards(await parseActivity(text.trim(), image ?? undefined));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Parse failed');
    }
    setParsing(false);
  };

  const doManual = () => {
    setError('');
    imageConsumedRef.current = false;
    setCards([emptyParsedActivity()]);
  };

  const doSave = async (idx: number) => {
    if (!cards) return;
    const card = cards[idx];
    setSavingIdx(idx);
    setError('');
    try {
      const attachImage = image && !imageConsumedRef.current ? image : undefined;
      await saveActivity(date, text.trim() || card.summary, card, attachImage);
      if (attachImage) imageConsumedRef.current = true;
      const remaining = cards.filter((_, i) => i !== idx);
      if (remaining.length === 0) {
        setCards(null);
        setText('');
        clearPhoto();
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 2500);
      } else {
        setCards(remaining);
      }
      loadRecent();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    }
    setSavingIdx(null);
  };

  const editField = (idx: number, k: keyof ParsedActivity, v: unknown) =>
    setCards((cs) => (cs ? cs.map((c, i) => (i === idx ? { ...c, [k]: v } : c)) : cs));

  const numField = (idx: number, card: ParsedActivity, k: keyof ParsedActivity, label: string, opts?: { min?: number; max?: number }) => (
    <label style={labelStyle}>{label}
      <input
        type="number"
        min={opts?.min}
        max={opts?.max}
        value={(card[k] as number | null) ?? ''}
        onChange={(e) => editField(idx, k, e.target.value === '' ? null : Number(e.target.value))}
        style={inputStyle}
      />
    </label>
  );

  if (entLoading) {
    return (
      <div className="app-layout">
        <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
        <div className="main-content"><div className="page-loading"><div className="loading-pulse" /></div></div>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>Log Activity</h1>
        </header>

        {!allowed ? (
          <div className="engine-page">
            <div className="engine-empty">
              <div className="engine-empty-title">Part of our training subscriptions</div>
              <div className="engine-empty-desc">
                Logging training done outside your program — and having your coach and
                programming account for it — comes with AI Programming and Year of the Engine.
              </div>
              <button className="engine-btn engine-btn-secondary" onClick={() => navigate(-1)}>
                <ChevronLeft size={16} /> Back
              </button>
            </div>
          </div>
        ) : (
          <div className="engine-page" style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{ maxWidth: 620, width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="engine-card">
                <div className="engine-section">
                  <p style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: 12 }}>
                    Did something outside your program — conditioning, a metcon, extra
                    strength or skills work? Describe it in plain words, or snap the
                    machine screen. It'll show on your calendar, your coach sees it right
                    away, and your programming accounts for it.
                  </p>
                  <span className="engine-label">Date</span>
                  <input
                    type="date"
                    value={date}
                    max={localDate()}
                    onChange={(e) => setDate(e.target.value)}
                    style={{ display: 'block', marginBottom: 12, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)' }}
                  />
                  <span className="engine-label">What did you do?</span>
                  <textarea
                    value={text}
                    onChange={(e) => { setText(e.target.value); setCards(null); }}
                    placeholder='e.g. "60 min echo bike zone 2, 489 cals" or "21-15-9 power snatch + T2B, 115 lbs — 4:13" or "5x8 strict pull-ups"'
                    rows={3}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 14, lineHeight: 1.5, resize: 'vertical' }}
                  />
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(e) => pickPhoto(e.target.files?.[0] ?? null)}
                  />
                  {imagePreview ? (
                    <div style={{ marginTop: 10, position: 'relative', display: 'inline-block' }}>
                      <img src={imagePreview} alt="Attached workout" style={{ maxWidth: 180, maxHeight: 120, borderRadius: 8, border: '1px solid var(--border)', display: 'block' }} />
                      <button
                        onClick={clearPhoto}
                        aria-label="Remove photo"
                        style={{ position: 'absolute', top: -8, right: -8, width: 22, height: 22, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ) : (
                    <button
                      className="engine-btn engine-btn-secondary"
                      onClick={() => fileRef.current?.click()}
                      style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                      <Camera size={15} /> Add a photo
                    </button>
                  )}
                  {!cards && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
                      <button
                        className="engine-btn engine-btn-primary"
                        onClick={doParse}
                        disabled={parsing || (text.trim().length < 3 && !image)}
                      >
                        {parsing ? <Loader2 size={16} className="spin" /> : 'Continue'}
                      </button>
                      <button
                        onClick={doManual}
                        style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 13, textDecoration: 'underline', padding: 0 }}
                      >
                        enter it manually
                      </button>
                    </div>
                  )}
                  {error && <p style={{ color: '#f87171', fontSize: 13, marginTop: 10 }}>{error}</p>}
                  {savedFlash && (
                    <p style={{ color: '#4ade80', fontSize: 13, marginTop: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Check size={14} /> Logged — it's on your calendar.
                    </p>
                  )}
                </div>
              </div>

              {cards?.map((card, idx) => (
                <div key={idx} className="engine-card" style={{ border: '1px solid var(--accent)' }}>
                  <div className="engine-section">
                    <span className="engine-label">
                      Confirm{cards.length > 1 ? ` (${idx + 1} of ${cards.length})` : ''}
                    </span>
                    {card.summary && <p style={{ fontSize: 15, fontWeight: 600, margin: '6px 0 10px' }}>{card.summary}</p>}

                    {/* Type chips — AI pre-selected; tap to correct. */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                      {WORKOUT_TYPES.map((t) => (
                        <button
                          key={t}
                          onClick={() => editField(idx, 'workout_type', t)}
                          style={{
                            padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                            border: card.workout_type === t ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                            background: card.workout_type === t ? 'var(--accent-glow)' : 'var(--surface2)',
                            color: card.workout_type === t ? 'var(--accent)' : 'var(--text-dim)',
                          }}
                        >
                          {TYPE_LABELS[t]}
                        </button>
                      ))}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 12 }}>
                      {/* Per-type field sets. Duration is universal; a metcon's
                          headline is its score, never a fake duration. */}
                      {(card.workout_type === 'strength' || card.workout_type === 'skills') && (
                        <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>Movement
                          <input value={card.movement ?? ''} onChange={(e) => editField(idx, 'movement', e.target.value || null)} style={inputStyle} />
                        </label>
                      )}
                      {card.workout_type === 'metcon' && (
                        <label style={labelStyle}>Score (time or rounds+reps)
                          <input value={card.score ?? ''} onChange={(e) => editField(idx, 'score', e.target.value || null)} placeholder='e.g. 4:13 or 12+7' style={inputStyle} />
                        </label>
                      )}
                      {(card.workout_type === 'strength' || card.workout_type === 'skills') && (
                        <>
                          {numField(idx, card, 'sets', 'Sets', { min: 1, max: 50 })}
                          {numField(idx, card, 'reps', 'Reps / set', { min: 1, max: 1000 })}
                          {numField(idx, card, 'weight', `Weight${card.weight_unit ? ` (${card.weight_unit})` : ''}`, { min: 0 })}
                        </>
                      )}
                      {numField(idx, card, 'duration_minutes', 'Minutes', { min: 1, max: 1439 })}
                      {card.workout_type === 'conditioning' && (
                        <>
                          {numField(idx, card, 'calories', 'Calories', { min: 1 })}
                          {numField(idx, card, 'distance', `Distance${card.distance_unit ? ` (${card.distance_unit})` : ''}`, { min: 0 })}
                        </>
                      )}
                      {numField(idx, card, 'rpe', 'RPE (1-10)', { min: 1, max: 10 })}
                      {numField(idx, card, 'avg_hr', 'Avg HR', { min: 40, max: 250 })}
                    </div>

                    {/* Effort is the one load signal the parser can't invent —
                        nudge for it, one tap of friction. */}
                    {card.rpe == null && (
                      <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '0 0 12px' }}>
                        How hard was it? Adding an RPE (1–10) helps your coach and programming
                        weigh this session.
                      </p>
                    )}

                    {card.is_benchmark && card.benchmark && (
                      <div style={{ padding: '10px 12px', background: 'rgba(250,204,21,.08)', border: '1px solid rgba(250,204,21,.35)', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
                        Benchmark detected: <strong>{card.benchmark.name}</strong> — {card.benchmark.value}{card.benchmark.unit ? ` ${card.benchmark.unit}` : ''}.
                        Saved with retest history. (Your profile's declared numbers aren't changed — update those in your profile if this test should drive programming loads.)
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="engine-btn engine-btn-primary" onClick={() => doSave(idx)} disabled={savingIdx != null}>
                        {savingIdx === idx ? <Loader2 size={16} className="spin" /> : 'Save'}
                      </button>
                      <button className="engine-btn engine-btn-secondary" onClick={() => setCards(null)} disabled={savingIdx != null}>
                        Edit text
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              {recent.length > 0 && (
                <div className="engine-card">
                  <div className="engine-section">
                    <span className="engine-label">Recent activities</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                      {recent.map((a) => (
                        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                          <span style={{ color: 'var(--text-dim)', flexShrink: 0 }}>{a.date}</span>
                          <span style={{ flex: 1 }}>
                            {(a.parsed?.summary as string | undefined) ?? `${a.activity_type ?? 'activity'}${a.duration_minutes ? ` · ${a.duration_minutes} min` : ''}`}
                          </span>
                          {a.workout_type && (
                            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.4px', flexShrink: 0 }}>
                              {TYPE_LABELS[a.workout_type]}
                            </span>
                          )}
                          <button
                            onClick={() => deleteActivity(a.id).then(loadRecent).catch(() => {})}
                            aria-label="Delete activity"
                            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
