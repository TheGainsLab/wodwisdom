import { useRef, useState } from 'react';
import { X, ImagePlus, Loader2 } from 'lucide-react';
import { CONTACT_COACH_ENDPOINT, getAuthHeaders } from '../lib/supabase';

// "Message a human coach" (founder spec, 2026-10-06): the relief valve for
// AI-chat miscommunication. One modal → one email to the coach, who replies
// by ORDINARY EMAIL to the user's account address. The modal's whole UX job
// is making that reply path unmissable — a user who taps a button in the
// app will otherwise wait for a reply in the app.

interface Attached {
  name: string;
  /** Always image/jpeg after re-encode (iPhone HEIC normalized away). */
  type: string;
  /** Raw base64, no data: prefix. */
  data: string;
  previewUrl: string;
}

const MAX_IMAGES = 2;
const MAX_DIM = 2000;

/** Re-encode any browser-decodable image to JPEG ≤2000px. Normalizes iPhone
 *  HEIC (Safari decodes it; the coach's mail client won't) and enforces the
 *  size cap BEFORE upload, so nothing big ever leaves the phone. */
async function toJpeg(file: File): Promise<Attached> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('unreadable'));
      el.src = url;
    });
    const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('unreadable');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return {
      name: (file.name || 'screenshot').replace(/\.[^.]+$/, '') + '.jpg',
      type: 'image/jpeg',
      data: dataUrl.split(',')[1] ?? '',
      previewUrl: dataUrl,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function CoachContactModal({ userEmail, onClose }: {
  userEmail: string;
  onClose: () => void;
}) {
  const [message, setMessage] = useState('');
  const [includeChat, setIncludeChat] = useState(true);
  const [images, setImages] = useState<Attached[]>([]);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [limitHit, setLimitHit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    setError(null);
    const room = MAX_IMAGES - images.length;
    for (const f of Array.from(files).slice(0, room)) {
      try {
        const att = await toJpeg(f);
        setImages((prev) => (prev.length < MAX_IMAGES ? [...prev, att] : prev));
      } catch {
        setError("Couldn't read that image — try a screenshot (JPEG/PNG).");
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const send = async () => {
    const text = message.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const resp = await fetch(CONTACT_COACH_ENDPOINT, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          include_chat: includeChat,
          images: images.map((i) => ({ name: i.name, type: i.type, data: i.data })),
        }),
      });
      const body = await resp.json().catch(() => ({}));
      if (resp.status === 429 && body?.code === 'LIMIT') {
        setLimitHit(true);
        return;
      }
      if (!resp.ok) {
        setError(body?.error || "Couldn't send — please try again.");
        return;
      }
      setSent(true);
    } catch {
      setError("Couldn't send — check your connection and try again.");
    } finally {
      setSending(false);
    }
  };

  const panel: React.CSSProperties = {
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14,
    width: 'min(480px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 64px)', overflowY: 'auto',
    padding: '20px 20px 16px', position: 'relative',
  };

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div onClick={(e) => e.stopPropagation()} style={panel}>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
        >
          <X size={18} />
        </button>

        {sent ? (
          <>
            <h3 style={{ margin: '0 0 10px', fontSize: 17 }}>Sent</h3>
            <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-dim)', margin: 0 }}>
              The reply goes to <strong>{userEmail}</strong> — usually within
              24 hours. Check your inbox, not this app (and the spam folder
              the first time).
            </p>
            <button className="engine-btn engine-btn-primary" onClick={onClose} style={{ marginTop: 16, width: '100%' }}>
              Got it
            </button>
          </>
        ) : limitHit ? (
          <>
            <h3 style={{ margin: '0 0 10px', fontSize: 17 }}>Your message is with the coach</h3>
            <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-dim)', margin: 0 }}>
              You've reached today's limit of 2 messages — your earlier
              message is with the coach, and the reply comes by email.
            </p>
            <button className="engine-btn engine-btn-primary" onClick={onClose} style={{ marginTop: 16, width: '100%' }}>
              Got it
            </button>
          </>
        ) : (
          <>
            <h3 style={{ margin: '0 0 6px', fontSize: 17 }}>Message a human coach</h3>
            <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--text-muted)', margin: '0 0 12px' }}>
              Replies come by email — usually within 24 hours. The AI Coach is
              always available in the meantime.
            </p>

            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, 2000))}
              rows={5}
              style={{
                width: '100%', resize: 'vertical', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.5,
                background: 'var(--bg, #101013)', color: 'var(--text)', border: '1px solid var(--border)',
                borderRadius: 10, padding: '10px 12px', boxSizing: 'border-box',
              }}
            />

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-dim)', margin: '10px 0 0', cursor: 'pointer' }}>
              <input type="checkbox" checked={includeChat} onChange={(e) => setIncludeChat(e.target.checked)} />
              Include my recent AI chat so the coach has context
            </label>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              {images.map((img, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <img src={img.previewUrl} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
                  <button
                    onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                    aria-label="Remove screenshot"
                    style={{ position: 'absolute', top: -6, right: -6, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '50%', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-dim)', padding: 0 }}
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
              {images.length < MAX_IMAGES && (
                <button
                  onClick={() => fileRef.current?.click()}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: '1px dashed var(--border)', borderRadius: 8, padding: '8px 12px', color: 'var(--text-muted)', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  <ImagePlus size={15} /> Attach screenshot
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
            </div>

            {error && <div style={{ fontSize: 13, color: 'var(--accent)', marginTop: 10 }}>{error}</div>}

            <button
              className="engine-btn engine-btn-primary"
              onClick={send}
              disabled={sending || !message.trim()}
              style={{ marginTop: 14, width: '100%', opacity: sending || !message.trim() ? 0.6 : 1 }}
            >
              {sending ? <Loader2 size={16} className="spin" /> : 'Send to coach'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
