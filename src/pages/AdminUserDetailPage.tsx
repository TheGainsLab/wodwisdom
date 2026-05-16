import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';

const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB
const MAX_IMAGES_PER_EMAIL = 4;

interface ComposerImage {
  cid: string;
  filename: string;
  content_type: string;
  content_base64: string;
  preview_url: string;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function AdherenceMetric({ label, num, den }: { label: string; num: number; den: number }) {
  const pct = den > 0 ? Math.round((num / den) * 100) : null;
  const color =
    pct == null ? 'var(--text-muted)' :
    pct >= 80 ? 'var(--accent)' :
    pct >= 50 ? 'var(--text)' :
    'var(--text-dim)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 88 }}>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text-muted)' }}>
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", color }}>
        {num}/{den}{pct != null && <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', marginLeft: 6 }}>{pct}%</span>}
      </div>
    </div>
  );
}

function AdherenceRowCard({ row }: { row: AdherenceRow }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{row.name || 'Untitled program'}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {row.program_version || 'v1'} &middot; {new Date(row.created_at).toLocaleDateString()}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <AdherenceMetric label="Workouts" num={row.completed_workouts} den={row.prescribed_workouts} />
        <AdherenceMetric label="Blocks" num={row.logged_blocks} den={row.prescribed_blocks} />
        <AdherenceMetric label="Skipped" num={row.skipped_entries} den={row.total_entries} />
      </div>
    </div>
  );
}

function Sparkline({ values, width = 180, height = 36 }: { values: number[]; width?: number; height?: number }) {
  if (values.length === 0) return null;
  if (values.length === 1) {
    return (
      <svg width={width} height={height}>
        <circle cx={width / 2} cy={height / 2} r={3} fill="var(--accent)" />
      </svg>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  const pad = 4;
  const innerH = height - pad * 2;
  const innerW = width - pad * 2;
  const coords = values.map((v, i) => {
    const x = pad + (i / Math.max(values.length - 1, 1)) * innerW;
    const y = pad + (1 - (v - min) / range) * innerH;
    return [x, y] as const;
  });
  const path = coords.map((c, i) => (i === 0 ? `M ${c[0]} ${c[1]}` : `L ${c[0]} ${c[1]}`)).join(' ');
  const lastCoord = coords[coords.length - 1];
  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      <path d={path} stroke="var(--accent)" strokeWidth={1.5} fill="none" />
      <circle cx={lastCoord[0]} cy={lastCoord[1]} r={3} fill="var(--accent)" />
    </svg>
  );
}

function LiftProgressCard({ lift }: { lift: LiftProgress }) {
  const latest = lift.points[lift.points.length - 1];
  const unit = lift.current_1rm_unit || 'lbs';
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{lift.display_name}</div>
        {lift.current_1rm != null && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            1RM: {Number(lift.current_1rm)}{unit}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Sparkline values={lift.points.map(p => Number(p.max_weight))} />
        {latest && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
              {Number(latest.max_weight)}{latest.weight_unit || unit}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              {new Date(latest.date).toLocaleDateString()} · {lift.points.length} day{lift.points.length === 1 ? '' : 's'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SkillVolumeCard({ skill }: { skill: SkillVolume }) {
  const values = skill.points.map(p => skill.metric === 'reps' ? Number(p.total_reps) : Number(p.total_hold_seconds));
  const latest = skill.points[skill.points.length - 1];
  const latestVal = latest ? (skill.metric === 'reps' ? Number(latest.total_reps) : Number(latest.total_hold_seconds)) : 0;
  const unitLabel = skill.metric === 'reps' ? 'reps' : 's';
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{skill.display_name}</div>
        {skill.self_rating && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Self-rating: {skill.self_rating}</div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Sparkline values={values} />
        {latest && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
              {latestVal}<span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', marginLeft: 4 }}>{unitLabel}</span>
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              {new Date(latest.date).toLocaleDateString()} · {skill.points.length} day{skill.points.length === 1 ? '' : 's'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="admin-stat-card">
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-muted)', marginTop: 32, marginBottom: 12 }}>
      {children}
    </h3>
  );
}

function FeatureBadge({ feature }: { feature: string }) {
  const colors: Record<string, string> = {
    ai_chat: '#2ec486',
    nutrition: '#6ea8fe',
    programming: 'var(--accent)',
    engine: '#f0a050',
  };
  const color = colors[feature] || '#666';
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5,
      color, background: color + '20',
      padding: '2px 8px', borderRadius: 4, whiteSpace: 'nowrap',
    }}>
      {feature.replace(/_/g, ' ')}
    </span>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500 }}>{value || '—'}</span>
    </div>
  );
}

interface EmailSendRow {
  id: string;
  template_key: string;
  subject: string;
  status: string;
  sent_at: string;
}

function statusColor(status: string): string {
  switch (status) {
    case 'sent': return '#6ea8fe';
    case 'delivered': return '#2ec486';
    case 'opened': return '#2ec486';
    case 'clicked': return '#2ec486';
    case 'bounced': return 'var(--accent)';
    case 'failed': return 'var(--accent)';
    default: return 'var(--text-muted)';
  }
}

function EmailSection({ userId, userEmail, userName }: { userId: string; userEmail: string; userName: string }) {
  const [templateKey, setTemplateKey] = useState<'welcome_back' | 'custom'>('custom');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [images, setImages] = useState<ComposerImage[]>([]);
  const [confirmArmed, setConfirmArmed] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sends, setSends] = useState<EmailSendRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgCounterRef = useRef(0);

  const addImage = async (file: File): Promise<string | null> => {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      return `Unsupported file type: ${file.type || 'unknown'}`;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return `Image too large (${Math.round(file.size / 1024 / 1024)}MB). Max 4MB.`;
    }
    if (images.length >= MAX_IMAGES_PER_EMAIL) {
      return `Max ${MAX_IMAGES_PER_EMAIL} images per email.`;
    }
    let content_base64: string;
    try {
      content_base64 = await fileToBase64(file);
    } catch {
      return 'Failed to read image file';
    }
    imgCounterRef.current += 1;
    const n = imgCounterRef.current;
    const cid = `img-${n}-${Date.now().toString(36)}`;
    const filename = file.name || `image-${n}.${(file.type.split('/')[1] || 'png')}`;
    const preview_url = URL.createObjectURL(file);
    const next: ComposerImage = { cid, filename, content_type: file.type, content_base64, preview_url };
    setImages((prev) => [...prev, next]);

    // Insert [image:N] token at the textarea cursor (or at end if no focus)
    const ta = textareaRef.current;
    const token = `[image:${n}]`;
    if (ta && document.activeElement === ta) {
      const start = ta.selectionStart ?? body.length;
      const end = ta.selectionEnd ?? body.length;
      const before = body.slice(0, start);
      const after = body.slice(end);
      const needsLeadingNewline = before.length > 0 && !before.endsWith('\n');
      const insertion = (needsLeadingNewline ? '\n' : '') + token + (after.startsWith('\n') ? '' : '\n');
      const newBody = before + insertion + after;
      setBody(newBody);
      // Restore caret just after the token
      requestAnimationFrame(() => {
        const pos = before.length + insertion.length;
        ta.focus();
        ta.setSelectionRange(pos, pos);
      });
    } else {
      setBody((prev) => (prev.length > 0 && !prev.endsWith('\n') ? `${prev}\n${token}\n` : `${prev}${token}\n`));
    }
    setConfirmArmed(false);
    return null;
  };

  const handleFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    for (const f of arr) {
      const err = await addImage(f);
      if (err) { setError(err); return; }
    }
    setError('');
  };

  const removeImage = (cid: string) => {
    const target = images.find((x) => x.cid === cid);
    if (target) URL.revokeObjectURL(target.preview_url);
    setImages((prev) => prev.filter((x) => x.cid !== cid));
    // Strip the [image:N] token from the body. We don't renumber remaining
    // images on screen, so the body's token order may have gaps — that's
    // fine, the renderer matches by number, not position.
    const idxMatch = target ? Number(target.cid.split('-')[1]) : NaN;
    if (Number.isFinite(idxMatch)) {
      const re = new RegExp(`\\n?\\[image:${idxMatch}\\]\\n?`, 'g');
      setBody((prev) => prev.replace(re, ''));
    }
    setConfirmArmed(false);
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const it of Array.from(items)) {
      if (it.kind === 'file') {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      void handleFiles(files);
    }
  };

  const onDrop = (e: React.DragEvent<HTMLTextAreaElement>) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    void handleFiles(e.dataTransfer.files);
  };

  const onDragOver = (e: React.DragEvent<HTMLTextAreaElement>) => {
    if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
  };

  const loadHistory = async () => {
    setLoadingHistory(true);
    const { data } = await supabase
      .from('email_sends')
      .select('id, template_key, subject, status, sent_at')
      .eq('user_id', userId)
      .order('sent_at', { ascending: false })
      .limit(10);
    setSends((data as EmailSendRow[] | null) ?? []);
    setLoadingHistory(false);
  };

  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const armSend = () => {
    setError('');
    if (templateKey === 'custom') {
      if (!subject.trim()) { setError('Subject is required'); return; }
      if (!body.trim()) { setError('Message body is required'); return; }
    }
    setConfirmArmed(true);
  };

  const cancelArm = () => {
    setConfirmArmed(false);
    setError('');
  };

  const doSend = async () => {
    setSending(true);
    setError('');
    try {
      const attachments = templateKey === 'custom'
        ? images.map((img) => ({
            cid: img.cid,
            filename: img.filename,
            content_type: img.content_type,
            content_base64: img.content_base64,
          }))
        : [];
      const payload = templateKey === 'custom'
        ? { user_id: userId, template_key: 'custom', subject, body, attachments }
        : { user_id: userId, template_key: 'welcome_back' };
      const { data, error: invokeErr } = await supabase.functions.invoke('admin-send-email', { body: payload });
      if (invokeErr) throw new Error(invokeErr.message || 'Send failed');
      if (data?.error) throw new Error(data.error);
      setSubject('');
      setBody('');
      images.forEach((img) => URL.revokeObjectURL(img.preview_url));
      setImages([]);
      imgCounterRef.current = 0;
      setConfirmArmed(false);
      await loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed');
    }
    setSending(false);
  };

  const previewSubject = templateKey === 'welcome_back' ? 'Just checking in' : (subject || '(no subject)');

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 32, marginBottom: 12 }}>
        <h3 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-muted)', margin: 0 }}>
          Email
        </h3>
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Template</label>
          <select
            value={templateKey}
            onChange={(e) => { setTemplateKey(e.target.value as 'welcome_back' | 'custom'); setConfirmArmed(false); setError(''); }}
            style={{ width: '100%', padding: '10px 12px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontFamily: "'Outfit', sans-serif", fontSize: 14 }}
          >
            <option value="custom">Custom message</option>
            <option value="welcome_back">Welcome Back (reactivation)</option>
          </select>
        </div>

        {templateKey === 'custom' ? (
          <>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Subject</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => { setSubject(e.target.value); setConfirmArmed(false); }}
                placeholder="Just checking in"
                style={{ width: '100%', padding: '10px 12px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontFamily: "'Outfit', sans-serif", fontSize: 14 }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                Message <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--text-muted)' }}>— use {'{first_name}'} for personalization. Blank lines = paragraphs. Supports **bold**, *italic*, and [text](url) links. Paste, drop, or attach images to insert them inline.</span>
              </label>
              <textarea
                ref={textareaRef}
                value={body}
                onChange={(e) => { setBody(e.target.value); setConfirmArmed(false); }}
                onPaste={onPaste}
                onDrop={onDrop}
                onDragOver={onDragOver}
                rows={8}
                placeholder={`Hey {first_name},\n\nJust checking in — wanted to see how training is going. Anything I can help with?\n\n— Matt`}
                style={{ width: '100%', padding: '10px 12px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontFamily: "'Outfit', sans-serif", fontSize: 14, resize: 'vertical', lineHeight: 1.5 }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ALLOWED_IMAGE_TYPES.join(',')}
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    if (e.target.files) void handleFiles(e.target.files);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={images.length >= MAX_IMAGES_PER_EMAIL}
                  style={{ background: 'transparent', color: 'var(--text-dim)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, fontFamily: "'Outfit', sans-serif", cursor: images.length >= MAX_IMAGES_PER_EMAIL ? 'not-allowed' : 'pointer', opacity: images.length >= MAX_IMAGES_PER_EMAIL ? 0.5 : 1 }}
                >
                  Attach image
                </button>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {images.length}/{MAX_IMAGES_PER_EMAIL} · max 4MB each
                </span>
              </div>
              {images.length > 0 && (
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  {images.map((img, i) => {
                    const n = Number(img.cid.split('-')[1]);
                    return (
                      <div key={img.cid} style={{ position: 'relative', width: 84, height: 84, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--surface2)' }}>
                        <img src={img.preview_url} alt={img.filename} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        <span style={{ position: 'absolute', top: 4, left: 4, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 3 }}>
                          {Number.isFinite(n) ? n : i + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeImage(img.cid)}
                          aria-label="Remove image"
                          style={{ position: 'absolute', top: 4, right: 4, width: 18, height: 18, borderRadius: 9, border: 'none', background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 12, lineHeight: 1, cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : (
          <div style={{ background: 'var(--surface2)', border: '1px solid var(--border-light)', borderRadius: 8, padding: 12, fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5 }}>
            Reactivation template. Subject: <strong style={{ color: 'var(--text)' }}>Just checking in</strong>. The body explains the chat is now usable without a profile, includes the AI Coach CTA, and a soft mention of paid plans. The user's first name is interpolated automatically.
          </div>
        )}

        {error && (
          <div style={{ fontSize: 13, color: 'var(--accent)', padding: '8px 0' }}>{error}</div>
        )}

        {!confirmArmed ? (
          <button
            onClick={armSend}
            disabled={sending}
            style={{ alignSelf: 'flex-start', background: 'var(--accent)', color: '#ffffff', border: 'none', borderRadius: 8, padding: '10px 18px', fontSize: 14, fontWeight: 600, fontFamily: "'Outfit', sans-serif", cursor: sending ? 'not-allowed' : 'pointer', opacity: sending ? 0.6 : 1 }}
          >
            Send →
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>
              Sending to <strong style={{ color: 'var(--text)' }}>{userName}</strong> ({userEmail})
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>
              Subject: <strong style={{ color: 'var(--text)' }}>{previewSubject}</strong>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={doSend}
                disabled={sending}
                style={{ background: '#2ec486', color: '#ffffff', border: 'none', borderRadius: 8, padding: '10px 18px', fontSize: 14, fontWeight: 600, fontFamily: "'Outfit', sans-serif", cursor: sending ? 'not-allowed' : 'pointer', opacity: sending ? 0.6 : 1 }}
              >
                {sending ? 'Sending…' : 'Confirm Send'}
              </button>
              <button
                onClick={cancelArm}
                disabled={sending}
                style={{ background: 'transparent', color: 'var(--text-dim)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 18px', fontSize: 14, fontWeight: 600, fontFamily: "'Outfit', sans-serif", cursor: sending ? 'not-allowed' : 'pointer' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Email History</div>
        {loadingHistory ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>
        ) : sends.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No emails sent yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sends.map((s) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13 }}>
                <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', minWidth: 130 }}>{new Date(s.sent_at).toLocaleString()}</span>
                <span style={{ color: 'var(--text-dim)', minWidth: 100 }}>{s.template_key.replace(/_/g, ' ')}</span>
                <span style={{ flex: 1, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.subject}</span>
                <span style={{
                  fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5,
                  color: statusColor(s.status), background: statusColor(s.status) + '20',
                  padding: '2px 8px', borderRadius: 4, whiteSpace: 'nowrap',
                }}>{s.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

interface AdherenceRow {
  id: string;
  name: string | null;
  created_at: string;
  program_version: string | null;
  prescribed_workouts: number;
  completed_workouts: number;
  prescribed_blocks: number;
  logged_blocks: number;
  total_entries: number;
  skipped_entries: number;
}

interface LiftPoint {
  date: string;
  max_weight: number;
  weight_unit: string | null;
}

interface LiftProgress {
  lift_key: string;
  display_name: string;
  current_1rm: number | null;
  current_1rm_unit: string | null;
  points: LiftPoint[];
}

interface SkillPoint {
  date: string;
  total_reps: number;
  total_hold_seconds: number;
}

interface SkillVolume {
  skill_key: string;
  display_name: string;
  self_rating: string | null;
  metric: 'reps' | 'hold_seconds';
  points: SkillPoint[];
}

export default function AdminUserDetailPage({ session: _session }: { session: Session }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [adherence, setAdherence] = useState<AdherenceRow[] | null>(null);
  const [liftProgress, setLiftProgress] = useState<LiftProgress[] | null>(null);
  const [skillVolume, setSkillVolume] = useState<SkillVolume[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const [{ data: result, error: err }, { data: adh }, { data: lifts }, { data: skills }] = await Promise.all([
        supabase.rpc('admin_user_detail', { target_user_id: id, tz }),
        supabase.rpc('admin_user_adherence', { target_user_id: id }),
        supabase.rpc('admin_user_lift_progress', { target_user_id: id }),
        supabase.rpc('admin_user_skill_volume', { target_user_id: id }),
      ]);
      if (err) { setError(err.message); setLoading(false); return; }
      setData(result);
      setAdherence((adh as AdherenceRow[]) ?? []);
      setLiftProgress((lifts as LiftProgress[]) ?? []);
      setSkillVolume((skills as SkillVolume[]) ?? []);
      setLoading(false);
    })();
  }, [id]);

  const profile = data?.profile;
  const athlete = data?.athlete_profile;
  const chat = data?.chat;
  const engine = data?.engine;
  const nutrition = data?.nutrition;
  const workouts = data?.workouts;

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>User Detail</h1>
        </header>
        <div className="page-body">
          <div style={{ maxWidth: 700, margin: '0 auto' }}>
            {/* Back button */}
            <button
              onClick={() => navigate('/admin')}
              style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 14, fontFamily: "'Outfit', sans-serif", padding: '4px 0', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
              Back to Users
            </button>

            {error && <div className="auth-error" style={{ display: 'block', marginBottom: 16 }}>{error}</div>}

            {loading ? <div className="page-loading"><div className="loading-pulse" /></div> : data ? (
              <>
                {/* Account Info */}
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
                    <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--accent-glow)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 800, color: 'var(--accent)' }}>
                      {(profile?.full_name?.[0] || profile?.email?.[0] || '?').toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontSize: 18, fontWeight: 700 }}>{profile?.full_name || 'No name'}</div>
                      <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>{profile?.email}</div>
                    </div>
                    {profile?.role === 'admin' && (
                      <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: 'var(--accent)', background: 'var(--accent-glow)', padding: '2px 8px', borderRadius: 4, marginLeft: 'auto' }}>Admin</span>
                    )}
                  </div>
                  <InfoRow label="Signup Date" value={profile?.signup_date ? new Date(profile.signup_date).toLocaleDateString() : null} />
                  <InfoRow label="Role" value={profile?.role} />
                  <InfoRow label="Stripe Customer" value={profile?.stripe_customer_id || 'None'} />
                </div>

                {/* Entitlements */}
                {data.entitlements && data.entitlements.length > 0 && (
                  <>
                    <SectionHeader>Entitlements</SectionHeader>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {data.entitlements.map((e: any, i: number) => (
                        <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                          <FeatureBadge feature={e.feature} />
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>via {e.source}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* Profile Completeness */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 32, marginBottom: 12 }}>
                  <h3 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-muted)', margin: 0 }}>
                    Athlete Profile
                  </h3>
                  <button
                    onClick={() => navigate(`/admin/users/${id}/athlete-profile`)}
                    style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: "'Outfit', sans-serif", padding: 0 }}
                  >
                    View full →
                  </button>
                </div>
                {athlete ? (
                  <div
                    className="admin-stats-grid"
                    onClick={() => navigate(`/admin/users/${id}/athlete-profile`)}
                    style={{ cursor: 'pointer' }}
                  >
                    <StatCard label="Lifts" value={athlete.lift_count || 0} sub={athlete.has_lifts ? 'entered' : 'none'} />
                    <StatCard label="Skills" value={athlete.skill_count || 0} sub={athlete.has_skills ? 'assessed' : 'none'} />
                    <StatCard label="Conditioning" value={athlete.has_conditioning ? 'Yes' : 'No'} />
                    <StatCard label="Engine Day" value={athlete.engine_current_day || 1} sub={`${athlete.engine_months_unlocked || 1} months unlocked`} />
                  </div>
                ) : (
                  <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, color: 'var(--text-muted)', fontSize: 13 }}>
                    No athlete profile created yet.
                  </div>
                )}

                {/* Email */}
                {id && profile?.email && (
                  <EmailSection
                    userId={id}
                    userEmail={profile.email}
                    userName={profile.full_name || profile.email}
                  />
                )}

                {/* Chat Usage */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 32, marginBottom: 12 }}>
                  <h3 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-muted)', margin: 0 }}>
                    Chat
                  </h3>
                  <button
                    onClick={() => navigate(`/admin/users/${id}/chat`)}
                    style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: "'Outfit', sans-serif", padding: 0 }}
                  >
                    View transcripts →
                  </button>
                </div>
                <div
                  className="admin-stats-grid"
                  onClick={() => navigate(`/admin/users/${id}/chat`)}
                  style={{ cursor: 'pointer' }}
                >
                  <StatCard label="Total Questions" value={chat?.total_questions || 0} />
                  <StatCard label="Last 7 Days" value={chat?.questions_7d || 0} />
                  <StatCard label="Last 30 Days" value={chat?.questions_30d || 0} />
                  <StatCard label="Total Tokens" value={((chat?.total_input_tokens || 0) + (chat?.total_output_tokens || 0)).toLocaleString()} />
                </div>
                {chat?.last_question && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                    Last question: {new Date(chat.last_question).toLocaleString()}
                  </div>
                )}

                {/* Engine */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 32, marginBottom: 12 }}>
                  <h3 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-muted)', margin: 0 }}>
                    Engine
                  </h3>
                  <button
                    onClick={() => navigate(`/admin/users/${id}/engine-sessions`)}
                    style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: "'Outfit', sans-serif", padding: 0 }}
                  >
                    View sessions →
                  </button>
                </div>
                <div
                  className="admin-stats-grid"
                  onClick={() => navigate(`/admin/users/${id}/engine-sessions`)}
                  style={{ cursor: 'pointer' }}
                >
                  <StatCard label="Sessions" value={engine?.total_sessions || 0} />
                  <StatCard label="Last 30 Days" value={engine?.sessions_30d || 0} />
                  <StatCard label="Avg Performance" value={engine?.avg_performance_ratio || '—'} />
                </div>
                {engine?.modalities && engine.modalities.length > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                    Modalities: {engine.modalities.join(', ')}
                  </div>
                )}
                {engine?.last_session && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                    Last session: {new Date(engine.last_session).toLocaleString()}
                  </div>
                )}

                {/* Nutrition */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 32, marginBottom: 12 }}>
                  <h3 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-muted)', margin: 0 }}>
                    Nutrition
                  </h3>
                  <button
                    onClick={() => navigate(`/admin/users/${id}/nutrition`)}
                    style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: "'Outfit', sans-serif", padding: 0 }}
                  >
                    View log →
                  </button>
                </div>
                <div
                  className="admin-stats-grid"
                  onClick={() => navigate(`/admin/users/${id}/nutrition`)}
                  style={{ cursor: 'pointer' }}
                >
                  <StatCard label="Total Entries" value={nutrition?.total_entries || 0} />
                  <StatCard label="Days Logged" value={nutrition?.days_logged || 0} />
                  <StatCard label="Last 30 Days" value={nutrition?.entries_30d || 0} />
                  <StatCard label="Avg Calories" value={nutrition?.avg_daily_calories || '—'} />
                </div>
                {nutrition?.last_entry && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                    Last entry: {new Date(nutrition.last_entry).toLocaleString()}
                  </div>
                )}

                {/* Workouts */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 32, marginBottom: 12 }}>
                  <h3 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-muted)', margin: 0 }}>
                    Training Log
                  </h3>
                  <button
                    onClick={() => navigate(`/admin/users/${id}/workouts`)}
                    style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: "'Outfit', sans-serif", padding: 0 }}
                  >
                    View logs →
                  </button>
                </div>
                <div
                  className="admin-stats-grid"
                  onClick={() => navigate(`/admin/users/${id}/workouts`)}
                  style={{ cursor: 'pointer' }}
                >
                  <StatCard label="Workouts Logged" value={workouts?.total_logged || 0} />
                  <StatCard label="Last 30 Days" value={workouts?.logged_30d || 0} />
                </div>
                {workouts?.last_logged && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                    Last logged: {new Date(workouts.last_logged).toLocaleString()}
                  </div>
                )}

                {/* Programs */}
                {data.programs && data.programs.length > 0 && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 32, marginBottom: 12 }}>
                      <h3 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-muted)', margin: 0 }}>
                        Programs
                      </h3>
                      <button
                        onClick={() => navigate(`/admin/users/${id}/programs`)}
                        style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: "'Outfit', sans-serif", padding: 0 }}
                      >
                        View all →
                      </button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {data.programs.map((p: any) => (
                        <button
                          key={p.id}
                          onClick={() => navigate(`/admin/users/${id}/programs/${p.id}`)}
                          style={{ textAlign: 'left', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', fontFamily: "'Outfit', sans-serif", color: 'var(--text)' }}
                        >
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 500 }}>{p.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.source} &middot; {p.workout_count} workouts &middot; {new Date(p.created_at).toLocaleDateString()}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {/* Adherence */}
                {adherence && adherence.length > 0 && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 32, marginBottom: 12 }}>
                      <h3 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-muted)', margin: 0 }}>
                        Adherence
                      </h3>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Last {adherence.length} program{adherence.length === 1 ? '' : 's'}</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {adherence.map(a => <AdherenceRowCard key={a.id} row={a} />)}
                    </div>
                  </>
                )}

                {/* Lift Progress */}
                {liftProgress && liftProgress.length > 0 && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 32, marginBottom: 12 }}>
                      <h3 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-muted)', margin: 0 }}>
                        Lift Progress
                      </h3>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Last 90 days</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {liftProgress.map(l => <LiftProgressCard key={l.lift_key} lift={l} />)}
                    </div>
                  </>
                )}

                {/* Skill Volume */}
                {skillVolume && skillVolume.length > 0 && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 32, marginBottom: 12 }}>
                      <h3 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-muted)', margin: 0 }}>
                        Skill Volume
                      </h3>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Last 90 days</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {skillVolume.map(s => <SkillVolumeCard key={s.skill_key} skill={s} />)}
                    </div>
                  </>
                )}

                {/* Evaluations */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 32, marginBottom: 12 }}>
                  <h3 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-muted)', margin: 0 }}>
                    Evaluations
                  </h3>
                  <button
                    onClick={() => navigate(`/admin/users/${id}/evaluations`)}
                    style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: "'Outfit', sans-serif", padding: 0 }}
                  >
                    View all →
                  </button>
                </div>
                {data.evaluations && data.evaluations.length > 0 ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {data.evaluations.map((e: any) => (
                      <button
                        key={e.id}
                        onClick={() => navigate(`/admin/users/${id}/evaluations/profile/${e.id}`)}
                        style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', fontSize: 12, color: 'var(--text-dim)', cursor: 'pointer', fontFamily: "'Outfit', sans-serif" }}
                      >
                        Profile · {new Date(e.created_at).toLocaleDateString()}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, color: 'var(--text-muted)', fontSize: 13 }}>
                    No profile evaluations yet.
                  </div>
                )}

                <div style={{ height: 40 }} />
              </>
            ) : (
              <div className="empty-state"><p>User not found.</p></div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
