import { useEffect, useState } from 'react';
import { Zap, Activity, Shuffle, Loader2, Check } from 'lucide-react';
import {
  loadPrograms,
  saveProgramVersion,
  switchProgram,
  type EngineProgram,
} from '../../lib/engineService';

interface Props {
  /** Called after a program is saved. */
  onSelected: (version: string) => void;
  /** If set, this is a switch (not initial pick) — shows confirmation. */
  currentProgram?: string | null;
}

function programIcon(id: string) {
  if (id.includes('varied')) return <Shuffle size={20} color="var(--text-dim)" />;
  if (id.includes('5day')) return <Zap size={20} color="var(--accent)" />;
  return <Activity size={20} color="var(--text-dim)" />;
}

export default function ProgramSelection({ onSelected, currentProgram }: Props) {
  const [programs, setPrograms] = useState<EngineProgram[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const isSwitching = currentProgram != null;

  useEffect(() => {
    loadPrograms()
      .then(setPrograms)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const select = async (programId: string) => {
    // If switching and user hasn't confirmed yet, show confirmation
    if (isSwitching && confirmId !== programId) {
      setConfirmId(programId);
      return;
    }

    setSaving(true);
    try {
      if (isSwitching) {
        await switchProgram(programId);
      } else {
        await saveProgramVersion(programId);
      }
      onSelected(programId);
    } catch {
      // user can retry
    }
    setSaving(false);
    setConfirmId(null);
  };

  if (loading) {
    return (
      <div className="engine-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={24} className="spin" style={{ color: 'var(--text-dim)' }} />
      </div>
    );
  }

  return (
    <div className="engine-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="engine-card" style={{ maxWidth: 560, width: '100%' }}>
        <div className="engine-section">
          <h2 className="engine-header">
            {isSwitching ? 'Switch Program' : 'Choose Your Program'}
          </h2>
          <p className="engine-subheader">
            {isSwitching
              ? 'Select a new program variant. You\'ll pick up at the same month in the new program.'
              : 'Select the training program that fits your schedule. You can change this later.'}
          </p>
          <hr className="engine-divider" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {programs.map((prog) => {
              const isCurrent = prog.id === currentProgram;
              const isConfirming = confirmId === prog.id;

              return (
                <button
                  key={prog.id}
                  className="engine-card"
                  onClick={() => !isCurrent && select(prog.id)}
                  disabled={saving || isCurrent}
                  style={{
                    cursor: isCurrent ? 'default' : 'pointer',
                    textAlign: 'left',
                    transition: 'all .2s',
                    borderColor: isCurrent ? 'var(--accent)' : isConfirming ? '#facc15' : undefined,
                    opacity: isCurrent ? 0.7 : 1,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    {programIcon(prog.id)}
                    <span style={{ fontSize: 16, fontWeight: 700, flex: 1 }}>{prog.name}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                      {prog.days_per_week}x/week
                    </span>
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: 8 }}>
                    {prog.description}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="engine-badge engine-badge--default">
                      {prog.total_days} days
                    </span>
                    {isCurrent && (
                      <span className="engine-badge engine-badge--endurance" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Check size={12} /> Current
                      </span>
                    )}
                    {prog.sort_order === 1 && !isSwitching && (
                      <span className="engine-badge engine-badge--strength">Recommended</span>
                    )}
                  </div>

                  {isConfirming && (
                    <div style={{
                      marginTop: 12,
                      padding: '10px 12px',
                      background: 'rgba(250,204,21,.08)',
                      borderRadius: 8,
                      fontSize: 13,
                      lineHeight: 1.5,
                      color: 'var(--text)',
                    }}>
                      You'll pick up at the same month in this program.
                      Your completed workouts and analytics are preserved.
                      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                        <button
                          className="engine-btn engine-btn-primary engine-btn-sm"
                          onClick={(e) => { e.stopPropagation(); select(prog.id); }}
                          disabled={saving}
                          style={{ fontSize: 13 }}
                        >
                          {saving ? <Loader2 size={14} className="spin" /> : 'Confirm Switch'}
                        </button>
                        <button
                          className="engine-btn engine-btn-secondary engine-btn-sm"
                          onClick={(e) => { e.stopPropagation(); setConfirmId(null); }}
                          style={{ fontSize: 13 }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
