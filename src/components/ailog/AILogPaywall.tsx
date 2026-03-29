import { useNavigate } from 'react-router-dom';
import { Lock, Brain } from 'lucide-react';

export default function AILogPaywall() {
  const navigate = useNavigate();

  return (
    <div className="ailog-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="ailog-card" style={{ maxWidth: 480, width: '100%', textAlign: 'center' }}>
        <div className="ailog-section" style={{ alignItems: 'center' }}>
          <div style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background: 'var(--accent-glow)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--accent)',
          }}>
            <Brain size={28} />
          </div>

          <h2 className="ailog-header">AI Log</h2>
          <p className="ailog-subheader" style={{ maxWidth: 360 }}>
            Upload your gym's programming, find gaps in your training,
            and get AI-powered supplemental recommendations.
          </p>

          <hr className="ailog-divider" style={{ width: '100%' }} />

          <div className="ailog-grid" style={{ width: '100%' }}>
            <div className="ailog-stat" style={{ textAlign: 'center' }}>
              <div className="ailog-stat-value" style={{ fontSize: 22 }}>AI</div>
              <div className="ailog-stat-label">Gap Analysis</div>
            </div>
            <div className="ailog-stat" style={{ textAlign: 'center' }}>
              <div className="ailog-stat-value" style={{ fontSize: 22 }}>1-3</div>
              <div className="ailog-stat-label">Sessions / Week</div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', textAlign: 'left' }}>
            {[
              'Upload any gym\'s programming for analysis',
              'Personalized gap detection across modality, time domain, and skills',
              'AI-generated supplemental sessions to fill gaps',
              'Score tracking and performance analytics on external workouts',
            ].map((item) => (
              <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--text-dim)' }}>
                <Lock size={12} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
                {item}
              </div>
            ))}
          </div>

          <hr className="ailog-divider" style={{ width: '100%' }} />

          <button
            className="ailog-btn ailog-btn-primary"
            onClick={() => navigate('/checkout')}
            style={{ width: '100%' }}
          >
            <Brain size={18} /> Upgrade to Access AI Log
          </button>
        </div>
      </div>
    </div>
  );
}
