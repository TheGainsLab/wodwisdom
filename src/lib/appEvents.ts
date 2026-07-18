import { supabase } from './supabase';

/**
 * appEvents — stage D capture: track(event, props), fire-and-forget.
 *
 * THE VOCABULARY IS FIXED. Each event answers a standing question; adding
 * one means naming the question it answers (and updating the migration
 * comment). Never put free text, full URLs, or identifiers beyond route
 * patterns into props.
 *
 *   page_view             { path }        feature touch + session depth
 *   workout_viewed        { kind, day? }  the train-without-log numerator
 *   timer_started         { day? }        did the workout happen in-app
 *   log_started           { kind }        friction: started vs submitted is
 *                                         derivable by joining real logs
 *   nutrition_method      { method }      photo/barcode/search earn-keep
 *   eval_viewed           {}              does the eval have a shelf life
 *   paywall_hit           { feature }     which locked doors get knocked on
 *   install_prompt        { outcome }     shown/accepted/dismissed
 *   billing_portal_opened {}              pre-churn intent, days early
 *   client_error          { path, msg }   silent breakage made visible
 *   profile_started       {}              the eval funnel's missing middle
 *   share_used            { kind }        word-of-mouth machinery usage
 *
 * Fire-and-forget: failures are swallowed, offline events drop (v1 —
 * the derivable-by-join design keeps the important truths intact).
 * Signed-out calls are no-ops.
 */

type AppEvent =
  | 'page_view'
  | 'workout_viewed'
  | 'timer_started'
  | 'log_started'
  | 'nutrition_method'
  | 'eval_viewed'
  | 'paywall_hit'
  | 'install_prompt'
  | 'billing_portal_opened'
  | 'client_error'
  | 'profile_started'
  | 'share_used';

export function track(event: AppEvent, props: Record<string, string | number | boolean> = {}): void {
  try {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return;
      supabase.from('app_events')
        .insert({ user_id: session.user.id, event, props })
        .then(() => {}, () => {});
    }, () => {});
  } catch { /* tracking must never break the app */ }
}

/** Normalize a location pathname to a low-cardinality route pattern. */
export function routePattern(pathname: string): string {
  return pathname
    // uuids / numeric ids / tokens → :id
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:id');
}
