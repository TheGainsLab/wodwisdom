import { useState } from 'react';
import { Zap, Activity } from 'lucide-react';
import { saveProgramVersion } from '../../lib/engineService';

interface Props {
  onSelected: (version: string) => void;
}

export default function ProgramSelection({ onSelected }: Props) {
  const [saving, setSaving] = useState(false);

  const select = async (version: string) => {
    setSaving(true);
    try {
      await saveProgramVersion(version);
      onSelected(version);
    } catch {
      // user can retry
    }
    setSaving(false);
  };

  return (
    <div className="engine-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="engine-card" style={{ maxWidth: 520, width: '100%' }}>
        <div className="engine-section">
          <h2 className="engine-header">Choose Your Program</h2>
          <p className="engine-subheader">
            Select the training frequency that fits your schedule. You can change this later.
          </p>
          <hr className="engine-divider" />
          <div className="engine-grid">
            <button
              className="engine-card"
              onClick={() => select('5-day')}
              disabled={saving}
              style={{ cursor: 'pointer', textAlign: 'left', transition: 'all .2s' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <Zap size={20} color="var(--accent)" />
                <span style={{ fontSize: 16, fontWeight: 700 }}>5-Day</span>
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: 12 }}>
                720 training days. The full Engine — 5 sessions per week across 36 months.
              </p>
              <span className="engine-badge engine-badge--strength">Recommended</span>
            </button>
            <button
              className="engine-card"
              onClick={() => select('3-day')}
              disabled={saving}
              style={{ cursor: 'pointer', textAlign: 'left', transition: 'all .2s' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <Activity size={20} color="var(--text-dim)" />
                <span style={{ fontSize: 16, fontWeight: 700 }}>3-Day</span>
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: 12 }}>
                432 training days. Same program quality — 3 sessions per week.
              </p>
              <span className="engine-badge engine-badge--default">Flexible</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
