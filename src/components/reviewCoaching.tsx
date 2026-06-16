// Shared coaching renderers + types for the workout review ("Coach") content.
// Used by the standalone WorkoutReviewPage and by the per-block inline coaching
// on ProgramDetailPage / StartWorkoutPage (Option A: coaching lives on the block).
import { useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface ReviewSource { title: string; author?: string; source?: string; }

export interface ReviewBlockCue {
  movement: string;
  cues: string[];
  common_faults: string[];
}

export interface ReviewBlock {
  block_type: string;
  block_label: string;
  prescription?: string;
  time_domain: string;
  cues_and_faults: ReviewBlockCue[];
}

export interface WorkoutReview {
  intent: string;
  blocks?: ReviewBlock[];
  sources: ReviewSource[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export function formatReviewMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n- /g, '<br>• ')
    .replace(/\n/g, '<br>')
    .replace(/^/, '<p>')
    .replace(/$/, '</p>')
    .replace(/<p><\/p>/g, '');
}

export const BLOCK_TYPE_LABELS: Record<string, string> = {
  skills: 'Skills',
  strength: 'Strength',
  metcon: 'Metcon',
  accessory: 'Accessory',
};

export const CHEVRON_DOWN = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

/** Find the review's coaching for a given day block, matched by block_type. */
export function coachingForBlockType(review: WorkoutReview | null, blockType: string): ReviewBlock | null {
  if (!review?.blocks) return null;
  return review.blocks.find(b => b.block_type === blockType) ?? null;
}

// ---------------------------------------------------------------------------
// Movement card — one movement's cues + common faults
// ---------------------------------------------------------------------------
export function MovementCard({ cf }: { cf: ReviewBlockCue }) {
  return (
    <div className="wr-movement-card">
      <div className="wr-movement-name">{cf.movement}</div>
      {cf.cues && cf.cues.length > 0 && (
        <ul className="wr-cue-list">
          {cf.cues.map((cue, j) => (
            <li key={j} className="wr-cue-item">
              <svg className="wr-cue-icon wr-cue-icon--do" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              <span>{cue}</span>
            </li>
          ))}
        </ul>
      )}
      {cf.common_faults && cf.common_faults.length > 0 && (
        <ul className="wr-cue-list wr-fault-list">
          {cf.common_faults.map((fault, j) => (
            <li key={j} className="wr-cue-item wr-fault-item">
              <svg className="wr-cue-icon wr-cue-icon--avoid" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              <span>{fault}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Block coaching body — prescription + time domain + per-movement cues.
// The inner content only (no header/toggle), so it can drop under a block row
// that owns its own "Coach ▾" disclosure.
// ---------------------------------------------------------------------------
export function BlockCoachingBody({ block }: { block: ReviewBlock }) {
  return (
    <div className="workout-review-block-body">
      {block.prescription && (
        <div className={`wr-prescription wr-prescription--${block.block_type}`}>
          <div className="workout-review-content" dangerouslySetInnerHTML={{ __html: formatReviewMarkdown(block.prescription) }} />
        </div>
      )}
      {block.time_domain && (
        <div className="wr-time-domain">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
          <div className="workout-review-content" dangerouslySetInnerHTML={{ __html: formatReviewMarkdown(block.time_domain) }} />
        </div>
      )}
      {block.cues_and_faults && block.cues_and_faults.length > 0 && (
        <div className="wr-movement-cards">
          {block.cues_and_faults.map((cf, i) => (
            <MovementCard key={i} cf={cf} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collapsible block (header + body) — used by the standalone Coach page.
// ---------------------------------------------------------------------------
export function CollapsibleBlock({ block, defaultOpen }: { block: ReviewBlock; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const label = BLOCK_TYPE_LABELS[block.block_type] || block.block_label;
  return (
    <div className="workout-review-section workout-review-block">
      <button className="workout-review-block-header" onClick={() => setOpen(!open)} aria-expanded={open}>
        <div className="workout-review-block-title">
          <span className={`workout-review-block-badge workout-review-block-badge--${block.block_type}`}>{label}</span>
        </div>
        <span className={`workout-review-block-chevron${open ? ' workout-review-block-chevron--open' : ''}`}>{CHEVRON_DOWN}</span>
      </button>
      {open && <BlockCoachingBody block={block} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Session intent — collapsible "why" for the whole day. Default collapsed.
// ---------------------------------------------------------------------------
export function IntentDisclosure({ intent }: { intent: string }) {
  const [open, setOpen] = useState(false);
  if (!intent?.trim()) return null;
  return (
    <div className="wr-sources-section">
      <button className="wr-sources-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="wr-sources-label">Today's training intent</span>
        <span className={`workout-review-block-chevron${open ? ' workout-review-block-chevron--open' : ''}`}>{CHEVRON_DOWN}</span>
      </button>
      {open && (
        <div className="wr-intent-card" style={{ marginTop: 8 }}>
          <div className="workout-review-content" dangerouslySetInnerHTML={{ __html: formatReviewMarkdown(intent) }} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sources — collapsible chip list at the bottom.
// ---------------------------------------------------------------------------
export function SourcesSection({ sources }: { sources: ReviewSource[] }) {
  const [open, setOpen] = useState(false);
  const titles = [...new Set(sources.map(s => s.title).filter(Boolean))];
  if (titles.length === 0) return null;
  return (
    <div className="wr-sources-section">
      <button className="wr-sources-toggle" onClick={() => setOpen(!open)}>
        <span className="wr-sources-label">Sources ({titles.length})</span>
        <span className={`workout-review-block-chevron${open ? ' workout-review-block-chevron--open' : ''}`}>{CHEVRON_DOWN}</span>
      </button>
      {open && (
        <div className="wr-sources-list">
          {titles.map((t, j) => (
            <span key={j} className="source-chip">{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}
