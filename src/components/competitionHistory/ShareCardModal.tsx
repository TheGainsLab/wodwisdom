/**
 * ShareCardModal — the share UX over a single card (competition result OR engine
 * session). Card-type-agnostic: the caller builds the ShareCardData and supplies
 * a stable `cacheId` for memoization.
 *
 * Renders the full-size <ShareCard> OFF-SCREEN (the capture node) and shows the
 * user a preview that is just the generated PNG in an <img> (scaled by CSS for
 * display only — never captured). A story/square toggle, plus Share (Web Share
 * API → native sheet) and Save (download) actions.
 *
 * Generated blobs are memoized per cacheId+format+version, so toggling back and
 * forth — or reopening — never re-renders, and a design bump (CARD_VERSION)
 * cleanly invalidates the cache.
 */

import { useEffect, useRef, useState } from 'react';
import { track } from '../../lib/appEvents';
import {
  cardFilename,
  cardShareText,
  CARD_DIMENSIONS,
  CARD_VERSION,
  downloadBlob,
  renderCardToPng,
  shareOrDownload,
  type ShareCardData,
  type ShareCardFormat,
} from '../../lib/shareCard';
import ShareCard from './ShareCard';

function defaultFormat(): ShareCardFormat {
  if (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches) return 'story';
  return 'square';
}

export default function ShareCardModal({
  data,
  cacheId,
  onClose,
}: {
  data: ShareCardData;
  /** Stable id for memoizing the rendered blob (e.g. result id+bodyweight, or session id). */
  cacheId: string;
  onClose: () => void;
}) {
  // Stage D: word-of-mouth machinery usage.
  useEffect(() => { track('share_used', { kind: 'competition' }); }, []);
  const captureRef = useRef<HTMLDivElement>(null);
  const cacheRef = useRef<Map<string, Blob>>(new Map());
  const [format, setFormat] = useState<ShareCardFormat>(defaultFormat);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<'rendering' | 'idle' | 'error'>('rendering');
  const [toast, setToast] = useState<string | null>(null);

  const keyFor = (f: ShareCardFormat) => `${cacheId}:${f}:${CARD_VERSION}`;

  // Generate (or reuse cached) blob whenever the format / card changes. Runs
  // after commit, so captureRef points at the current-format card.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus('rendering');
      const key = keyFor(format);
      let b = cacheRef.current.get(key) ?? null;
      if (!b) {
        const node = captureRef.current;
        if (!node) return;
        try {
          b = await renderCardToPng(node, format);
          cacheRef.current.set(key, b);
        } catch {
          if (!cancelled) setStatus('error');
          return;
        }
      }
      if (cancelled) return;
      setBlob(b);
      setStatus('idle');
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format, cacheId]);

  // Object URL for the preview <img>, revoked when the blob changes/unmounts.
  useEffect(() => {
    if (!blob) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  const filename = cardFilename(data, format);

  const onShare = async () => {
    if (!blob) return;
    const outcome = await shareOrDownload(blob, filename, cardShareText(data));
    if (outcome === 'downloaded') setToast('Saved — post it anywhere');
  };

  const onSave = () => {
    if (!blob) return;
    downloadBlob(blob, filename);
    setToast('Saved — post it anywhere');
  };

  const { width, height } = CARD_DIMENSIONS[format];
  const aspect = `${width} / ${height}`;

  return (
    <div
      onClick={(e) => {
        // Stop the click from bubbling to the WorkoutDetail overlay this modal
        // is nested inside (which would also close the detail behind it).
        e.stopPropagation();
        onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '24px 16px',
        overflowY: 'auto',
        zIndex: 1200,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          maxWidth: 420,
          width: '100%',
          padding: 20,
        }}
      >
        {/* header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Share your result</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 22, lineHeight: 1, cursor: 'pointer', padding: 4 }}
          >
            ×
          </button>
        </div>

        {/* format toggle */}
        <div style={{ display: 'flex', gap: 6, marginTop: 14 }}>
          {(['story', 'square'] as ShareCardFormat[]).map((f) => {
            const active = format === f;
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFormat(f)}
                style={{
                  flex: 1,
                  padding: '7px 12px',
                  fontSize: 12,
                  borderRadius: 6,
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                  background: active ? 'var(--accent)' : 'var(--surface2)',
                  color: active ? '#fff' : 'var(--text)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  textTransform: 'capitalize',
                }}
              >
                {f === 'story' ? 'Story · 9:16' : 'Square · 1:1'}
              </button>
            );
          })}
        </div>

        {/* preview */}
        <div
          style={{
            marginTop: 16,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            background: 'var(--surface)',
            borderRadius: 10,
            padding: 12,
            minHeight: 240,
          }}
        >
          {status === 'error' ? (
            <div style={{ fontSize: 13, color: 'var(--danger, #d33)', textAlign: 'center' }}>
              Couldn't render the card. Please try again.
            </div>
          ) : previewUrl ? (
            <img
              src={previewUrl}
              alt="Score card preview"
              style={{
                maxWidth: format === 'story' ? 220 : 300,
                width: '100%',
                aspectRatio: aspect,
                objectFit: 'contain',
                borderRadius: 6,
                display: 'block',
              }}
            />
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>Rendering…</div>
          )}
        </div>

        {/* actions */}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button
            type="button"
            className="auth-btn"
            disabled={!blob}
            onClick={onShare}
            style={{ flex: 1, padding: '10px 16px', fontSize: 14, opacity: blob ? 1 : 0.6 }}
          >
            Share
          </button>
          <button
            type="button"
            className="auth-btn"
            disabled={!blob}
            onClick={onSave}
            style={{
              flex: 1,
              padding: '10px 16px',
              fontSize: 14,
              background: 'var(--surface2)',
              color: 'var(--text)',
              opacity: blob ? 1 : 0.6,
            }}
          >
            Save image
          </button>
        </div>

        {toast && <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-dim)', textAlign: 'center' }}>{toast}</div>}
      </div>

      {/* OFF-SCREEN capture node — full-size, never shown. */}
      <div aria-hidden style={{ position: 'fixed', left: -99999, top: 0, pointerEvents: 'none', opacity: 0 }}>
        <div ref={captureRef}>
          <ShareCard data={data} format={format} />
        </div>
      </div>
    </div>
  );
}
