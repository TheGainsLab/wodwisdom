/**
 * shareCard — data assembly + PNG capture + share/download for the shareable
 * competition score cards. Rendering is CLIENT-SIDE: a hidden, exact-pixel
 * <ShareCard> node (see ShareCard.tsx) is snapshotted to a PNG with
 * html-to-image, then handed to the Web Share API (mobile) or downloaded
 * (desktop). All result data is already on the client `entry`; the power score
 * is personalized here via personalizedPower() — the same helper the result
 * view uses — so there is no server round-trip.
 */

import { toPng } from 'html-to-image';
import type { CompetitionWorkoutEntry, ScoringUnit } from './competitionHistory';
import { personalizedPower } from './competitionHistory';
import type { EngineWorkoutSession } from './engineService';
import { engineModalityLabel } from './engineService';

/** Bump on ANY ShareCard design change — it's part of the blob memo key, so a
 *  design tweak never serves a stale cached image. */
export const CARD_VERSION = 1;

export const BRAND_URL = 'thegainslab.com';

export type ShareCardFormat = 'story' | 'square';

export const CARD_DIMENSIONS: Record<ShareCardFormat, { width: number; height: number }> = {
  story: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
};

const STAGE_LABEL: Record<string, string> = {
  open: 'Open',
  quarterfinals: 'Quarterfinals',
  semifinals: 'Semifinals',
  regional: 'Regionals',
  games: 'Games',
};

/** Format a raw competition score for display. Shared with WorkoutDetail. */
export function formatScore(unit: ScoringUnit, value: number, text: string | null): string {
  if (text) return text;
  switch (unit) {
    case 'time': {
      const m = Math.floor(value / 60);
      const s = Math.round(value % 60);
      return `${m}:${String(s).padStart(2, '0')}`;
    }
    case 'reps':
      return `${value} reps`;
    case 'load_lbs':
      return `${value} lb`;
    case 'distance':
      return `${value} m`;
    default:
      return String(value);
  }
}

function truncateName(name: string, max = 24): string {
  const n = name.trim();
  return n.length > max ? n.slice(0, max - 1).trimEnd() + '…' : n;
}

/** A competition result card (placement + power). */
export interface CompetitionShareCardData {
  kind: 'competition';
  year: number;
  eventLabel: string; // "2024 CrossFit Open"
  workoutName: string; // "Workout 24.1"
  score: string; // "7:47" | "247 reps"
  athleteName: string; // truncated to ≤24 chars
  brandUrl: string;
  /** "Top X%" placement — set ONLY when the athlete is top-25% worldwide. */
  placementTopX: number | null;
  /** Personalized power; null when there's no power read for this workout. */
  power: { watts: number; wPerKg: number | null } | null;
}

/** A Year of the Engine session card (anonymous; no percentile, no power). */
export interface EngineShareCardData {
  kind: 'engine';
  dayNumber: number | null;
  dayTypeLabel: string;
  modalityLabel: string;
  workValue: string; // total output, locale-formatted
  workUnit: string; // cal | meters | watts | …
  paceValue: string | null; // null when the unit is a rate (watts)
  paceUnit: string | null; // e.g. "cal/min"
  /** One accent line, by priority: PR → above-target → held; null = below (never shown). */
  accent: string | null;
  spine: string; // "Paced to my fitness — built from my own time trial."
  brandUrl: string;
}

export type ShareCardData = CompetitionShareCardData | EngineShareCardData;

export function buildShareCardData(
  entry: CompetitionWorkoutEntry,
  userKg: number | null | undefined,
  athleteName: string | null | undefined,
): CompetitionShareCardData {
  const r = entry.result;
  const stageLabel = STAGE_LABEL[entry.stage] ?? entry.stage;
  const power = personalizedPower(entry, userKg);

  // Placement: top-25% only (worldwide percentile ≥ 75). max(1, …) floors it so
  // an elite 99.6th-pct result reads "Top 1%", never the nonsensical "Top 0%".
  const pct = r.worldwide_percentile;
  const placementTopX =
    Number.isFinite(pct) && pct >= 75 ? Math.max(1, Math.round(100 - pct)) : null;

  return {
    kind: 'competition',
    year: entry.year,
    eventLabel: `${entry.year} CrossFit ${stageLabel}`,
    workoutName: entry.workout_name,
    score: formatScore(r.scoring_unit, r.raw_score, r.raw_score_text),
    athleteName: truncateName(athleteName ?? 'Athlete'),
    brandUrl: BRAND_URL,
    placementTopX,
    power: power ? { watts: power.watts, wPerKg: power.wPerKg } : null,
  };
}

export const ENGINE_SPINE = 'Paced to my fitness — built from my own time trial.';

/**
 * Build the engine card data from a saved session. `isPR` (best PACE for this
 * day-type/modality/units) is computed by the caller — see getBestPaceForDayType
 * in engineService. The accent line follows a strict priority and NEVER prints a
 * miss (below target → null).
 */
export function buildEngineShareCardData(
  session: EngineWorkoutSession,
  opts: { dayTypeLabel: string; isPR: boolean },
): EngineShareCardData {
  const isRate = (session.units ?? '') === 'watts';
  const ratio = session.performance_ratio;
  const dtl = session.day_type ? prettyLabel(opts.dayTypeLabel) : 'Engine';

  // PR is scoped to this day type (best pace on this kind of session), so name it
  // explicitly — a fast short day never reads as beating a long endurance day.
  let accent: string | null = null;
  if (opts.isPR) accent = `${dtl} PR`;
  else if (ratio != null && ratio >= 1.05) accent = `${Math.round((ratio - 1) * 100)}% above target`;
  else if (ratio != null && ratio >= 0.95) accent = 'Held target';

  return {
    kind: 'engine',
    dayNumber: session.program_day_number,
    dayTypeLabel: dtl,
    modalityLabel: engineModalityLabel(session.modality),
    workValue: session.total_output != null ? session.total_output.toLocaleString() : '—',
    workUnit: session.units ?? '',
    paceValue: !isRate && session.actual_pace != null ? session.actual_pace.toFixed(1) : null,
    paceUnit: !isRate && session.actual_pace != null ? `${session.units ?? ''}/min` : null,
    accent,
    spine: ENGINE_SPINE,
    brandUrl: BRAND_URL,
  };
}

function prettyLabel(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Power variant when we have a W/kg value — that's the hero (competition only). */
export function isPowerVariant(data: ShareCardData): boolean {
  return data.kind === 'competition' && data.power != null && data.power.wPerKg != null;
}

/** PNG filename, e.g. gains-2024-Workout-24-1-story.png / gains-engine-day-42-story.png */
export function cardFilename(data: ShareCardData, format: ShareCardFormat): string {
  if (data.kind === 'engine') {
    return `gains-engine-day-${data.dayNumber ?? 'x'}-${format}.png`;
  }
  const slug = data.workoutName.replace(/\W+/g, '-').replace(/^-+|-+$/g, '');
  return `gains-${data.year}-${slug}-${format}.png`;
}

/** Share-sheet copy, per card kind. */
export function cardShareText(data: ShareCardData): { title: string; text: string } {
  if (data.kind === 'engine') {
    return {
      title: 'Year of the Engine',
      text: `Day ${data.dayNumber ?? ''} of Year of the Engine — ${data.dayTypeLabel} ${data.modalityLabel}, paced to my fitness. ${BRAND_URL}`,
    };
  }
  const lead = `${data.eventLabel} ${data.workoutName}`;
  const stat =
    isPowerVariant(data) && data.power?.wPerKg != null
      ? `${data.power.wPerKg.toFixed(1)} W/kg`
      : data.score;
  return { title: 'My power score', text: `${lead} — ${stat} · ${BRAND_URL}` };
}

/**
 * Snapshot a mounted, exact-pixel card node to a PNG Blob. Device-safe sequence:
 *  1. Ensure Outfit 400/500 are actually loaded — `document.fonts.ready` alone
 *     can resolve before the face is even requested.
 *  2. pixelRatio:1 + explicit width/height (= output px) so the device DPR can't
 *     change the image size across phones.
 *  3. Render TWICE, keep the second — works around the iOS Safari blank/half
 *     render bug. Run unconditionally on all platforms: a few hundred ms off-iOS
 *     buys one code path and zero user-agent sniffing.
 */
export async function renderCardToPng(node: HTMLElement, format: ShareCardFormat): Promise<Blob> {
  const { width, height } = CARD_DIMENSIONS[format];

  try {
    await Promise.all([
      document.fonts.load('400 16px Outfit'),
      document.fonts.load('500 16px Outfit'),
    ]);
    await document.fonts.ready;
  } catch {
    // Font loading is best-effort — capture anyway.
  }

  const opts = {
    pixelRatio: 1,
    width,
    height,
    canvasWidth: width,
    canvasHeight: height,
    cacheBust: true,
    backgroundColor: '#111113',
  };

  await toPng(node, opts); // throwaway warm-up (Safari)
  const dataUrl = await toPng(node, opts);
  const res = await fetch(dataUrl);
  return res.blob();
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export type ShareOutcome = 'shared' | 'downloaded';

/**
 * Share the PNG via the Web Share API when files are supported (primary mobile
 * path), otherwise download it. The `canShare({ files })` gate is the right one:
 * desktop Chrome reports canShare(text)=true but canShare(files)=false.
 */
export async function shareOrDownload(
  blob: Blob,
  filename: string,
  meta: { title: string; text: string },
): Promise<ShareOutcome> {
  const file = new File([blob], filename, { type: 'image/png' });

  if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: meta.title, text: meta.text });
      return 'shared';
    } catch (err) {
      // User dismissed the sheet → treat as a no-op (no misleading "saved" toast).
      if (err instanceof DOMException && err.name === 'AbortError') return 'shared';
      // Any other failure falls through to download.
    }
  }

  downloadBlob(blob, filename);
  return 'downloaded';
}
