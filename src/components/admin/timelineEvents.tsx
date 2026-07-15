/**
 * Shared rendering for the admin per-user activity timeline
 * (admin_user_timeline RPC). Used by the Recent Activity preview on the user
 * detail page and the full /admin/users/:id/timeline drill-down.
 */

export interface TimelineEvent {
  event_at: string;
  type: string;
  detail: Record<string, any>;
}

/** Filter groups for the drill-down page. Group keys map to RPC p_types. */
export const TIMELINE_GROUPS: { key: string; label: string; types: string[] }[] = [
  { key: 'account', label: 'Account', types: ['signup', 'email_confirmed', 'entitlement'] },
  { key: 'profile', label: 'Profile', types: ['profile_update'] },
  { key: 'evaluations', label: 'Evaluations', types: ['evaluation_profile', 'evaluation_training', 'evaluation_nutrition'] },
  { key: 'chat', label: 'Chat', types: ['chat_question', 'chat_rating'] },
  { key: 'engine', label: 'Engine', types: ['engine_session', 'time_trial'] },
  { key: 'workouts', label: 'Workouts', types: ['workout_log'] },
  { key: 'nutrition', label: 'Nutrition', types: ['nutrition_day'] },
  { key: 'programs', label: 'Programs', types: ['program_created'] },
  { key: 'email', label: 'Email', types: ['email'] },
];

const DOT_COLORS: Record<string, string> = {
  account: '#94a3b8',
  profile: '#60a5fa',
  evaluations: '#a78bfa',
  chat: '#f59e0b',
  engine: '#22c55e',
  workouts: '#2dd4bf',
  nutrition: '#f472b6',
  programs: '#38bdf8',
  email: '#f87171',
};

function groupOf(type: string): string {
  return TIMELINE_GROUPS.find((g) => g.types.includes(type))?.key ?? 'account';
}

export function eventColor(type: string): string {
  return DOT_COLORS[groupOf(type)] ?? '#94a3b8';
}

/** Primary line for an event. */
export function eventTitle(ev: TimelineEvent): string {
  const d = ev.detail ?? {};
  switch (ev.type) {
    case 'signup': return 'Account created';
    case 'email_confirmed': return 'Email confirmed';
    case 'profile_update': return d.op === 'INSERT' ? 'Athlete profile created' : 'Athlete profile updated';
    case 'evaluation_profile': return 'Profile evaluation generated';
    case 'evaluation_training': return 'Training evaluation generated';
    case 'evaluation_nutrition': return 'Nutrition evaluation generated';
    case 'chat_question': return 'Asked the AI Coach';
    case 'chat_rating': return d.rating === 1 ? 'Rated an answer 👍' : 'Rated an answer 👎';
    case 'engine_session': return `Engine session${d.program_day_number != null ? ` — day ${d.program_day_number}` : ''}`;
    case 'time_trial': return `Time trial — ${d.modality ?? '?'}`;
    case 'workout_log': return 'Logged a workout';
    case 'nutrition_day': return 'Logged nutrition';
    case 'program_created': return 'Program generated';
    case 'entitlement': return `Access granted: ${d.feature ?? '?'}`;
    case 'email': return `Email sent: ${d.subject ?? d.template_key ?? ''}`;
    default: return ev.type;
  }
}

/** Secondary line (may be empty). */
export function eventDetail(ev: TimelineEvent): string {
  const d = ev.detail ?? {};
  switch (ev.type) {
    case 'chat_question':
      return d.question ?? '';
    case 'engine_session': {
      const parts = [d.day_type?.replace(/_/g, ' '), d.modality];
      if (d.performance_ratio != null) parts.push(`ratio ${Number(d.performance_ratio).toFixed(2)}`);
      return parts.filter(Boolean).join(' · ');
    }
    case 'time_trial':
      return d.total_output != null ? `${d.total_output} ${d.units ?? ''}`.trim() : '';
    case 'workout_log': {
      const parts = [d.workout_type?.replace(/_/g, ' '), d.source_type, d.score ? `score ${d.score}` : null];
      return parts.filter(Boolean).join(' · ');
    }
    case 'nutrition_day':
      return `${d.day ?? ''} · ${d.entries ?? 0} entries · ${d.calories ?? 0} cal`;
    case 'program_created':
      return d.name ?? '';
    case 'entitlement': {
      const parts = [d.source_kind, d.expires_at ? `expires ${new Date(d.expires_at).toLocaleDateString()}` : null];
      return parts.filter(Boolean).join(' · ');
    }
    case 'email':
      return d.status && d.status !== 'sent' ? `status: ${d.status}` : '';
    default:
      return '';
  }
}

/** Deep link to the existing drill-down page for this event, if one exists. */
export function eventLink(ev: TimelineEvent, userId: string): string | null {
  const d = ev.detail ?? {};
  const base = `/admin/users/${userId}`;
  switch (ev.type) {
    case 'profile_update': return `${base}/athlete-profile`;
    case 'evaluation_profile': return d.id ? `${base}/evaluations/profile/${d.id}` : `${base}/evaluations`;
    case 'evaluation_training': return d.id ? `${base}/evaluations/training/${d.id}` : `${base}/evaluations`;
    case 'evaluation_nutrition': return d.id ? `${base}/evaluations/nutrition/${d.id}` : `${base}/evaluations`;
    case 'chat_question': return `${base}/chat`;
    case 'engine_session': return d.id ? `${base}/engine-sessions/${d.id}` : `${base}/engine-sessions`;
    case 'time_trial': return `${base}/engine-sessions`;
    case 'workout_log': return d.id ? `${base}/workouts/${d.id}` : `${base}/workouts`;
    case 'nutrition_day': return `${base}/nutrition`;
    case 'program_created': return d.id ? `${base}/programs/${d.id}` : `${base}/programs`;
    default: return null;
  }
}

export function formatEventTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

/** One timeline row. Renders as a button when the event deep-links somewhere. */
export function TimelineRow({
  ev,
  userId,
  onNavigate,
  compact = false,
}: {
  ev: TimelineEvent;
  userId: string;
  onNavigate: (path: string) => void;
  compact?: boolean;
}) {
  const link = eventLink(ev, userId);
  const detail = eventDetail(ev);
  const body = (
    <>
      <span style={{
        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
        background: eventColor(ev.type), marginTop: compact ? 5 : 6,
      }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: compact ? 12 : 13, color: 'var(--text)', fontWeight: 500 }}>
          {eventTitle(ev)}
        </span>
        {detail && (
          <span style={{
            display: 'block', fontSize: compact ? 11 : 12, color: 'var(--text-muted)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {detail}
          </span>
        )}
      </span>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, fontFamily: "'JetBrains Mono', monospace" }}>
        {formatEventTime(ev.event_at)}
      </span>
    </>
  );

  const style: React.CSSProperties = {
    display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%',
    padding: compact ? '6px 0' : '10px 0', textAlign: 'left',
    borderBottom: '1px solid var(--border)',
  };

  if (!link) return <div style={style}>{body}</div>;
  return (
    <button
      onClick={() => onNavigate(link)}
      style={{ ...style, background: 'none', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit' }}
    >
      {body}
    </button>
  );
}
