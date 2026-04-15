import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import AdminSubPageLayout from '../components/admin/AdminSubPageLayout';

// ── Helpers ──────────────────────────────────────────────────────────

const PROGRAM_VERSION_LABELS: Record<string, string> = {
  main_5day: 'Main 5-Day',
  main_5day_varied: 'Main 5-Day — Varied',
  main_3day: 'Main 3-Day',
  main_3day_varied: 'Main 3-Day — Varied',
  hyrox_5day: 'HYROX 5-Day',
  hyrox_3day: 'HYROX 3-Day',
  high_rocks: 'HIGHROCKS',
  vo2_maximizer: 'VO₂ Maximizer',
  vo2max_4day: 'VO₂ Max 4-Day',
  vo2max_3day: 'VO₂ Max 3-Day',
};

const EQUIPMENT_LABELS: Record<string, string> = {
  barbell: 'Barbell',
  dumbbells: 'Dumbbells',
  kettlebells: 'Kettlebells',
  rower: 'Rower',
  assault_bike: 'Assault/Echo Bike',
  ski_erg: 'Ski Erg',
  treadmill: 'Treadmill',
  pull_up_bar: 'Pull-up Bar',
  rings: 'Rings',
  parallettes: 'Parallettes',
  box: 'Plyo Box',
  ghd: 'GHD',
  wall_ball: 'Wall Ball',
  sled: 'Sled',
  rope: 'Climbing Rope',
  pegboard: 'Pegboard',
};

const LIFT_LABELS: Record<string, string> = {
  back_squat: 'Back Squat',
  front_squat: 'Front Squat',
  deadlift: 'Deadlift',
  bench_press: 'Bench Press',
  power_clean: 'Power Clean',
  clean_and_jerk: 'Clean & Jerk',
  snatch: 'Snatch',
  overhead_press: 'Overhead Press',
  push_press: 'Push Press',
};

const CONDITIONING_LABELS: Record<string, string> = {
  '1k_row': '1K Row',
  '2k_row': '2K Row',
  '5k_row': '5K Row',
  '500m_row': '500m Row',
  '1_mile_run': '1 Mile Run',
  '5k_run': '5K Run',
  '10k_run': '10K Run',
  '10min_bike_cals': '10 min Bike (cal)',
  '10min_row_cals': '10 min Row (cal)',
  '10min_ski_cals': '10 min Ski (cal)',
};

function humanize(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatUpdatedAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const month = Math.floor(day / 30);
  return `${month}mo ago`;
}

// ── Reusable section + row components ────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{
        fontSize: 12, fontWeight: 600, textTransform: 'uppercase',
        letterSpacing: 0.8, color: 'var(--text-muted)', marginBottom: 10,
      }}>{title}</h3>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 12, padding: 16,
      }}>
        {children}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '8px 0', borderBottom: '1px solid var(--border)',
      fontSize: 13,
    }}>
      <span style={{ color: 'var(--text-dim)' }}>{label}</span>
      <span style={{ fontWeight: 500, fontFamily: "'JetBrains Mono', monospace" }}>
        {value ?? '—'}
      </span>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────

export default function AdminAthleteProfilePage({ session }: { session: Session }) {
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      const { data: result, error: err } = await supabase.rpc('admin_get_athlete_profile', {
        target_user_id: id,
      });
      if (err) setError(err.message);
      else setData(result);
      setLoading(false);
    })();
  }, [id]);

  const profile = data?.athlete_profile;
  const unitSuffix = profile?.units ? ` ${profile.units}` : '';

  return (
    <AdminSubPageLayout session={session} userId={id!} title="Athlete Profile">
      {loading && <div className="page-loading"><div className="loading-pulse" /></div>}

      {error && (
        <div className="auth-error" style={{ display: 'block', marginBottom: 16 }}>
          {error}
        </div>
      )}

      {!loading && !profile && (
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, padding: 24, textAlign: 'center', color: 'var(--text-muted)',
        }}>
          No athlete profile created yet.
        </div>
      )}

      {profile && (
        <>
          {profile.updated_at && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
              Updated {formatUpdatedAgo(profile.updated_at)}
            </div>
          )}

          <Section title="Basic">
            <Row label="Age" value={profile.age} />
            <Row label="Gender" value={profile.gender} />
            <Row label="Height" value={profile.height ? `${profile.height} in` : null} />
            <Row label="Bodyweight" value={profile.bodyweight ? `${profile.bodyweight}${unitSuffix}` : null} />
            <Row label="Preferred Units" value={profile.units} />
          </Section>

          <Section title={`Lifts (${profile.units ?? ''})`}>
            {profile.lifts && Object.keys(profile.lifts).length > 0 ? (
              Object.entries(profile.lifts).map(([key, val]) => (
                <Row
                  key={key}
                  label={LIFT_LABELS[key] ?? humanize(key)}
                  value={val as number}
                />
              ))
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No lifts entered.</div>
            )}
          </Section>

          <Section title="Strength Levels">
            <Row label="Squat" value={profile.squat_level} />
            <Row label="Bench Press" value={profile.bench_level} />
            <Row label="Deadlift" value={profile.deadlift_level} />
            <Row label="Snatch" value={profile.snatch_level} />
            <Row label="Clean & Jerk" value={profile.clean_jerk_level} />
          </Section>

          <Section title="Conditioning">
            {profile.conditioning && Object.keys(profile.conditioning).length > 0 ? (
              Object.entries(profile.conditioning).map(([key, val]) => (
                <Row
                  key={key}
                  label={CONDITIONING_LABELS[key] ?? humanize(key)}
                  value={String(val)}
                />
              ))
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No conditioning data entered.</div>
            )}
          </Section>

          <Section title="Skills">
            {profile.skills && Object.keys(profile.skills).length > 0 ? (
              Object.entries(profile.skills).map(([key, val]) => (
                <Row
                  key={key}
                  label={humanize(key)}
                  value={String(val)}
                />
              ))
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No skills assessed.</div>
            )}
          </Section>

          <Section title="Engine">
            <Row
              label="Program"
              value={
                profile.engine_program_version ? (
                  <span>
                    {PROGRAM_VERSION_LABELS[profile.engine_program_version] ?? profile.engine_program_version}
                    <span style={{ color: 'var(--text-muted)', marginLeft: 6, fontSize: 11 }}>
                      ({profile.engine_program_version})
                    </span>
                  </span>
                ) : null
              }
            />
            <Row label="Current Day" value={profile.engine_current_day} />
            <Row label="Months Unlocked" value={profile.engine_months_unlocked} />
          </Section>

          <Section title="Equipment">
            {profile.equipment && Object.keys(profile.equipment).length > 0 ? (() => {
              const entries = Object.entries(profile.equipment as Record<string, boolean>);
              const have = entries.filter(([, v]) => v);
              const lack = entries.filter(([, v]) => !v);
              return (
                <>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                    {have.map(([k]) => (
                      <span key={k} style={{
                        fontSize: 11, background: 'var(--accent-glow)', color: 'var(--accent)',
                        padding: '3px 10px', borderRadius: 6, fontWeight: 500,
                      }}>
                        ✓ {EQUIPMENT_LABELS[k] ?? humanize(k)}
                      </span>
                    ))}
                  </div>
                  {lack.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {lack.map(([k]) => (
                        <span key={k} style={{
                          fontSize: 11, background: 'var(--border)', color: 'var(--text-muted)',
                          padding: '3px 10px', borderRadius: 6, fontWeight: 500,
                          textDecoration: 'line-through',
                        }}>
                          {EQUIPMENT_LABELS[k] ?? humanize(k)}
                        </span>
                      ))}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>
                    {have.length} of {entries.length} available
                  </div>
                </>
              );
            })() : (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No equipment data.</div>
            )}
          </Section>

          <Section title="Advanced">
            <Row
              label="TDEE Override"
              value={profile.tdee_override ? `${profile.tdee_override} cal` : 'auto-calculated'}
            />
          </Section>
        </>
      )}
    </AdminSubPageLayout>
  );
}
