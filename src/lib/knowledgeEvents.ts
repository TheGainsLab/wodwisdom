/**
 * Fire-and-forget usage logging for the research library. Never blocks or
 * breaks the page: failures are swallowed.
 *
 * Event types: entry_view, list_view, topic_filter, glossary_tap,
 * chart_table_view, discuss_click.
 */
import { supabase } from './supabase';

export function logKnowledgeEvent(
  eventType: string,
  slug?: string,
  meta?: Record<string, unknown>,
): void {
  supabase
    .from('knowledge_events')
    .insert({ event_type: eventType, slug: slug ?? null, meta: meta ?? null })
    .then(() => {}, () => {});
}
