import { useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import * as mammoth from 'mammoth';
import { supabase } from '../lib/supabase';
import { useEntitlements } from '../hooks/useEntitlements';
import Nav from '../components/Nav';
import { Camera, Upload } from 'lucide-react';
import '../ailog.css';

const SUPABASE_BASE = import.meta.env.VITE_SUPABASE_URL || 'https://hsiqzmbfulmfxbvbsdwz.supabase.co';
const PREPROCESS_ENDPOINT = SUPABASE_BASE + '/functions/v1/preprocess-program';

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export default function AILogUploadPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAdmin, loading: entLoading } = useEntitlements(session.user.id);

  if (!entLoading && !isAdmin) {
    navigate('/programs');
    return null;
  }
  const appendTo = searchParams.get('append'); // existing program id for "Add This Week"

  const [pasteText, setPasteText] = useState('');
  const [programName, setProgramName] = useState('');
  const [gymName, setGymName] = useState('');
  const isOngoing = false; // ongoing concept removed — each upload is a separate program
  const [pendingFile, setPendingFile] = useState<{ file: File; base64: string; fileType: string } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [navOpen, setNavOpen] = useState(false);

  const getAuthHeaders = useCallback(async () => {
    const { data: { session: s } } = await supabase.auth.getSession();
    const token = s?.access_token;
    if (!token) throw new Error('Not logged in');
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  }, []);

  const handleUpload = useCallback(async () => {
    const text = pasteText.trim();
    if (!text && !pendingFile) {
      setError('Paste some workout text or drop a file first');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const headers = await getAuthHeaders();
      const body: Record<string, any> = {
        source: 'external',
        gym_name: gymName.trim() || undefined,
        is_ongoing: isOngoing,
        committed: false, // starts as draft in AI Log workspace
      };

      if (appendTo) {
        body.append_to_program_id = appendTo;
      } else {
        body.name = programName.trim() || (gymName.trim() ? `${gymName.trim()} Programming` : 'External Program');
      }

      if (pendingFile) {
        body.file_base64 = pendingFile.base64;
        body.file_type = pendingFile.fileType;
      } else {
        body.text = text;
      }

      const res = await fetch(PREPROCESS_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      navigate(`/ailog/${data.program_id}`);
    } catch (err: any) {
      setError(err?.message || 'Failed to upload');
    } finally {
      setSaving(false);
    }
  }, [pasteText, programName, gymName, pendingFile, appendTo, getAuthHeaders, navigate]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;

    const ext = file.name.toLowerCase().split('.').pop() || '';
    const isTxt = ['text/plain', 'text/csv', 'application/csv'].includes(file.type) || ext === 'txt' || ext === 'csv';
    const isDocx = file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === 'docx';
    const isExcel = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'].includes(file.type) || ext === 'xlsx' || ext === 'xls';
    const isImage = ['image/png', 'image/jpeg', 'image/webp', 'image/heic'].includes(file.type) || ['png', 'jpg', 'jpeg', 'webp', 'heic'].includes(ext);
    const isPdf = file.type === 'application/pdf' || ext === 'pdf';

    if (!isTxt && !isDocx && !isExcel && !isImage && !isPdf) {
      setError('Use .txt, .csv, .docx, .xlsx, .pdf, or image files (.png, .jpg).');
      return;
    }

    setError('');
    setPendingFile(null);

    if (isTxt) {
      const reader = new FileReader();
      reader.onload = () => setPasteText(reader.result as string);
      reader.readAsText(file);
      return;
    }

    if (isDocx) {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const { value } = await mammoth.extractRawText({ arrayBuffer: reader.result as ArrayBuffer });
          setPasteText(value || '');
        } catch {
          setError('Could not read this Word file. Try pasting the text instead.');
        }
      };
      reader.readAsArrayBuffer(file);
      return;
    }

    if (isExcel) {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = arrayBufferToBase64(reader.result as ArrayBuffer);
        setPendingFile({ file, base64, fileType: ext === 'xls' ? 'xls' : 'xlsx' });
        setPasteText('');
      };
      reader.readAsArrayBuffer(file);
      return;
    }

    if (isImage) {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = arrayBufferToBase64(reader.result as ArrayBuffer);
        setPendingFile({ file, base64, fileType: ext === 'heic' ? 'heic' : ext === 'webp' ? 'webp' : ext === 'png' ? 'png' : 'jpg' });
        setPasteText('');
      };
      reader.readAsArrayBuffer(file);
      return;
    }

    if (isPdf) {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = arrayBufferToBase64(reader.result as ArrayBuffer);
        setPendingFile({ file, base64, fileType: 'pdf' });
        setPasteText('');
      };
      reader.readAsArrayBuffer(file);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); }, []);
  const handleDragLeave = useCallback(() => setIsDragOver(false), []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = arrayBufferToBase64(reader.result as ArrayBuffer);
          const ext = file.type === 'image/png' ? 'png' : 'jpg';
          setPendingFile({ file, base64, fileType: ext });
          setPasteText('');
        };
        reader.readAsArrayBuffer(file);
        return;
      }
    }
  }, []);

  const handleCameraCapture = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = arrayBufferToBase64(reader.result as ArrayBuffer);
      const ext = file.type === 'image/png' ? 'png' : 'jpg';
      setPendingFile({ file, base64, fileType: ext });
      setPasteText('');
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const canUpload = pasteText.trim().length > 0 || pendingFile != null;

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>{appendTo ? 'Add This Week' : 'Upload Programming'}</h1>
        </header>

        <div className="ailog-page">
          <div className="ailog-card">
            <div className="ailog-section">
              {!appendTo && (
                <>
                  <div>
                    <label className="ailog-label">Gym name</label>
                    <input
                      className="ailog-input"
                      type="text"
                      placeholder="e.g. CrossFit Riverside"
                      value={gymName}
                      onChange={e => setGymName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="ailog-label">Program name (optional)</label>
                    <input
                      className="ailog-input"
                      type="text"
                      placeholder="e.g. March Programming"
                      value={programName}
                      onChange={e => setProgramName(e.target.value)}
                    />
                  </div>
                  <hr className="ailog-divider" />
                </>
              )}

              <div
                className={'ailog-upload' + (isDragOver ? ' dragover' : '')}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onPaste={handlePaste}
                tabIndex={0}
              >
                <Upload size={24} style={{ color: 'var(--text-muted)' }} />
                <div className="ailog-upload-label">
                  Drop a file, paste an image (Cmd+V), or use the options below
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <label className="ailog-btn ailog-btn-secondary" style={{ padding: '6px 12px', fontSize: 12, borderRadius: 6, cursor: 'pointer' }}>
                    <Camera size={14} /> Take Photo
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleCameraCapture}
                      style={{ display: 'none' }}
                    />
                  </label>
                </div>
              </div>

              <textarea
                className="ailog-input"
                onPaste={handlePaste}
                placeholder={"Monday\nBack Squat 5x5 @275\nThen: 21-15-9 Thrusters (95/65) & Pull-ups\n\nTuesday\nRest\n\nWednesday\n5 RFT: 400m Run, 15 OHS (95/65)\n..."}
                value={pasteText}
                onChange={e => setPasteText(e.target.value)}
                rows={10}
                disabled={!!pendingFile}
                style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, resize: 'vertical' }}
              />

              {pendingFile && (
                <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                  Ready: {pendingFile.file.name}
                  <button type="button" style={{ marginLeft: 8, background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontFamily: 'inherit' }} onClick={() => setPendingFile(null)}>
                    Clear
                  </button>
                </p>
              )}

              {error && <div style={{ color: 'var(--error, #ef4444)', fontSize: 14 }}>{error}</div>}

              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  className="ailog-btn ailog-btn-secondary"
                  onClick={() => navigate(appendTo ? `/ailog/${appendTo}` : '/ailog')}
                  style={{ flex: 1 }}
                >
                  Cancel
                </button>
                <button
                  className="ailog-btn ailog-btn-primary"
                  onClick={handleUpload}
                  disabled={!canUpload || saving}
                  style={{ flex: 2 }}
                >
                  {saving ? 'Uploading...' : appendTo ? 'Add Week' : 'Upload Programming'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
