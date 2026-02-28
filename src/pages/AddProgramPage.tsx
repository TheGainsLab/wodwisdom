import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import * as mammoth from 'mammoth';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';

const PREPROCESS_ENDPOINT = (import.meta.env.VITE_SUPABASE_URL || 'https://hsiqzmbfulmfxbvbsdwz.supabase.co') + '/functions/v1/preprocess-program';

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export default function AddProgramPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [pasteText, setPasteText] = useState('');
  const [programName, setProgramName] = useState('');
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

  const uploadToPreprocess = useCallback(async (body: { name?: string; text?: string; file_base64?: string; file_type?: string }) => {
    const headers = await getAuthHeaders();
    const res = await fetch(PREPROCESS_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    return data as { program_id: string; workout_count: number };
  }, [getAuthHeaders]);

  const handleUpload = useCallback(async () => {
    if (pendingFile) {
      setSaving(true);
      setError('');
      try {
        const { program_id } = await uploadToPreprocess({
          name: programName.trim() || undefined,
          file_base64: pendingFile.base64,
          file_type: pendingFile.fileType,
        });
        setPendingFile(null);
        navigate(`/programs/${program_id}`);
      } catch (err: any) {
        setError(err?.message || 'Failed to upload program');
      } finally {
        setSaving(false);
      }
      return;
    }

    const text = pasteText.trim();
    if (!text) {
      setError('Paste some workout text or drop a file first');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const { program_id } = await uploadToPreprocess({
        name: programName.trim() || undefined,
        text,
      });
      navigate(`/programs/${program_id}`);
    } catch (err: any) {
      setError(err?.message || 'Failed to upload program');
    } finally {
      setSaving(false);
    }
  }, [pasteText, programName, pendingFile, uploadToPreprocess, navigate]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
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

    setError('');
    setPendingFile(null);

    if (isTxt) {
      const reader = new FileReader();
      reader.onload = () => {
        setPasteText(reader.result as string);
      };
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
          setError('Could not read this Word file. Try copying the text and pasting instead.');
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
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragOver(false), []);

  const canUpload = pasteText.trim().length > 0 || pendingFile != null;

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>Add program</h1>
        </header>
        <div className="page-body">
          <div className="programs-add-wrap">
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
                disabled={!!pendingFile}
              />
              {pendingFile && (
                <p className="program-pending-file" style={{ marginTop: 12, fontSize: 13, color: 'var(--text-dim)' }}>
                  Ready: {pendingFile.file.name}
                  <button type="button" className="link-btn" style={{ marginLeft: 8 }} onClick={() => setPendingFile(null)}>
                    Clear
                  </button>
                </p>
              )}
            </div>
            <div className="program-actions">
              <input
                type="text"
                className="program-name-input"
                placeholder="Program name (optional)"
                value={programName}
                onChange={e => setProgramName(e.target.value)}
              />
              <button className="auth-btn" onClick={handleUpload} disabled={!canUpload || saving}>
                {saving ? 'Uploading...' : 'Upload program'}
              </button>
            </div>
            {error && <div className="error-msg" style={{ marginTop: 12 }}>{error}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
