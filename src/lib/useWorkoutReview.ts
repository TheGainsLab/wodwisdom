// Hook that loads/generates a workout "Coach" review for a given workout, with
// localStorage caching keyed by source_id and invalidated when the workout text
// changes (i.e. the day was edited). Shared by the standalone Coach page and the
// per-block inline coaching. Generation is LAZY: nothing fires until generate()
// is called (e.g. the first time a user opens a block's "Coach ▾").
import { useCallback, useMemo, useState } from 'react';
import { supabase, FunctionsHttpError } from './supabase';
import type { WorkoutReview } from '../components/reviewCoaching';

interface CachedReview { workoutText: string; review: WorkoutReview }

/** Read a cached review for this source, treating an edited workout as a miss. */
export function restoreCachedReview(sourceId: string | null, workoutText: string): WorkoutReview | null {
  if (!sourceId) return null;
  try {
    const raw = localStorage.getItem(`wr_review_${sourceId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedReview;
    const incoming = workoutText.trim();
    // Content-aware invalidation: edited day → different text → regenerate.
    if (incoming && parsed.workoutText?.trim() !== incoming) return null;
    return parsed.review;
  } catch {
    return null;
  }
}

export function useWorkoutReview(sourceId: string | null, workoutText: string) {
  const trimmed = workoutText.trim();
  const cached = useMemo(() => restoreCachedReview(sourceId, workoutText), [sourceId, workoutText]);
  // Store the review WITH the text it was generated from, so an edit (text
  // change) drops the in-memory review instead of showing stale coaching.
  const [generated, setGenerated] = useState<{ forText: string; review: WorkoutReview } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveReview = (generated && generated.forText === trimmed) ? generated.review : cached;

  const generate = useCallback(async () => {
    if (loading) return;
    if (!trimmed) return;
    // Re-check the cache at call time (covers edits since mount).
    const fresh = restoreCachedReview(sourceId, workoutText);
    if (fresh) { setGenerated({ forText: trimmed, review: fresh }); return; }

    setError(null);
    setLoading(true);

    const finalize = (reviewData: WorkoutReview) => {
      setGenerated({ forText: trimmed, review: reviewData });
      try {
        if (sourceId) {
          localStorage.setItem(`wr_review_${sourceId}`, JSON.stringify({ workoutText: trimmed, review: reviewData }));
        }
      } catch { /* quota / private mode */ }
    };

    try {
      const { data: kickoff, error: kickoffErr } = await supabase.functions.invoke('workout-review', {
        body: { workout_text: trimmed, source_id: sourceId },
      });
      if (kickoffErr) {
        if (kickoffErr instanceof FunctionsHttpError && kickoffErr.context) {
          try {
            const body = await kickoffErr.context.json();
            const msg = body?.message || body?.error;
            if (typeof msg === 'string' && msg.trim()) throw new Error(msg);
          } catch (e) { if (e instanceof Error && e.message) throw e; }
        }
        throw new Error((kickoffErr as { message?: string }).message || 'Something went wrong');
      }
      if (kickoff?.error) throw new Error(kickoff.error);
      if (kickoff?.review) { finalize(kickoff.review as WorkoutReview); return; }

      const reviewId: string | null = kickoff?.review_id ?? null;
      if (!reviewId) throw new Error('No review id returned');

      let delay = 3000;
      const maxDelay = 8000;
      for (let i = 0; i < 80; i++) {
        await new Promise(r => setTimeout(r, delay));
        const { data: status, error: statusErr } = await supabase.functions.invoke('workout-review-status', {
          body: { review_id: reviewId },
        });
        if (statusErr) { delay = Math.min(delay + 1000, maxDelay); continue; }
        if (status?.status === 'complete' && status?.review) { finalize(status.review as WorkoutReview); return; }
        if (status?.status === 'failed') throw new Error(status.error || 'Coaching failed');
        delay = Math.min(delay + 1000, maxDelay);
      }
      throw new Error('Coaching timed out');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load coaching');
    } finally {
      setLoading(false);
    }
  }, [loading, sourceId, workoutText, trimmed]);

  return { review: effectiveReview, loading, error, generate };
}
