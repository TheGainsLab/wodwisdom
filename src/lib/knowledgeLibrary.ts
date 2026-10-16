/**
 * /knowledge — data access for the research library.
 *
 * The corpus lives in the knowledge_entries table (published rows are
 * world-readable via RLS; drafts are invisible), so an approved entry
 * publishes instantly with no deploy. src/data/knowledge keeps the founding
 * twelve as the versioned archive plus the ingestion contract
 * (ingestion-prompt.md, build.py); the app no longer imports entries from it.
 *
 * The glossary stays static for now — it merges on publish once the
 * ingestion pipeline lands (step 4).
 */

import { supabase } from './supabase';

export interface KnowledgeIndexRow {
  id: string;
  slug: string;
  title: string;
  /** The paper's own title — the card's red eyebrow line. */
  paper_title: string;
  authors: string;
  year: string;
  journal: string;
  shape: 'intervention' | 'comparison' | 'review' | 'reference';
  confidence: string;
  practical_relevance: string;
  topics: string[];
  chart_count: number;
}

export interface GlossaryTerm {
  term: string;
  definition: string;
  status: string;
  sources: string[];
  alt_definitions: Array<{ entry: string; definition: string }>;
}

export interface KnowledgeChart {
  template:
    | 'before_after_bars'
    | 'grouped_change_bars'
    | 'values_by_condition'
    | 'stacked_share'
    | 'timeline'
    | 'population_card'
    | 'concept_curve';
  title: string;
  // Series shapes vary per template (see data/knowledge ENTRY-FORMAT);
  // renderers narrow as needed.
  series: Array<Record<string, unknown>>;
  units: string;
  approximate: boolean;
  note: string;
}

export interface KnowledgeEntry {
  id: string;
  slug: string;
  /** 3–6 one-line findings, each a claim with its number; the fixed-format core of What they found. */
  key_findings?: string[];
  /** New terms this paper proposes for the glossary; merged on publish. */
  glossary_candidates?: Array<{ term: string; definition: string; confidence_term_is_new: string }>;
  verification_notes?: string[];
  shape: KnowledgeIndexRow['shape'];
  document_type: string;
  meta_analysis: boolean;
  header: {
    title_plain: string;
    /** Study shapes only: 2–4 plain sentences overviewing what was done. The page's lede. */
    setup_plain?: string;
    citation: {
      /** The paper's own title, verbatim from the source ("" until entered). */
      title: string;
      authors: string;
      year: string;
      journal: string;
      volume_issue_pages: string;
      doi: string;
    };
    topics: string[];
    evidence_type: string;
    confidence: { level: string; why: string };
    practical_relevance: { level: string; why: string };
    author_stance: string;
    funding_and_conflicts: string;
  };
  layer1: {
    intervention?: {
      groups: Array<{
        name: string; protocol: string; per_week: string; n_enrolled: string;
        n_analysed: string; age: string; sex: string; training_status: string; other: string;
      }>;
      design_notes: string;
      measured: Array<{
        outcome: string; unit: string; group: string; before: string; after: string;
        change: string; significant: string; note: string; charted?: boolean;
      }>;
    };
    comparison?: {
      who: Array<{ name: string; n: string; age: string; sex: string; training_status: string; other: string }>;
      conditions: Array<{ name: string; description: string; intensity: string; duration: string; other: string }>;
      design_notes: string;
      measured: Array<{
        outcome: string; unit: string; values_by_condition: Record<string, string>;
        differed: string; note: string; charted?: boolean;
      }>;
    };
    review?: {
      claim: string;
      definitions_used: Array<{ term: string; definition: string }>;
      // charted rows are drawn by one of the entry's charts; the page
      // collapses them behind a disclosure instead of printing them twice.
      evidence_cited: Array<{ finding: string; source: string; numbers: string; note: string; charted?: boolean }>;
      recommendations_made: string[];
      untested_or_contested: string;
    };
    reference?: {
      what_it_explains: string;
      key_numbers: Array<{ quantity: string; value: string; note: string }>;
      scope_limits: string;
    };
  };
  layer2: {
    what_it_means: string;
    what_it_doesnt_mean: string;
    questions_raised: Array<{ question: string; answer: string }>;
  };
  translation: string[];
  charts: KnowledgeChart[];
}

// Glossary lives in knowledge_glossary (publishing a paper merges its new
// terms). Loaded once per session; linkifyGlossary reads the current list.
let glossaryTerms: GlossaryTerm[] = [];
let glossaryLoad: Promise<void> | null = null;

export function getGlossaryTerms(): GlossaryTerm[] {
  return glossaryTerms;
}

export function ensureGlossary(): Promise<void> {
  if (!glossaryLoad) {
    glossaryLoad = (async () => {
      const { data } = await supabase
        .from('knowledge_glossary')
        .select('term, definition, status, sources, alt_definitions');
      if (data) glossaryTerms = data as GlossaryTerm[];
    })();
  }
  return glossaryLoad;
}

const REL_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

function toIndexRow(slug: string, e: KnowledgeEntry): KnowledgeIndexRow {
  return {
    id: e.id, slug,
    title: e.header.title_plain,
    paper_title: e.header.citation.title,
    authors: e.header.citation.authors,
    year: e.header.citation.year,
    journal: e.header.citation.journal,
    shape: e.shape,
    confidence: e.header.confidence.level,
    practical_relevance: e.header.practical_relevance.level,
    topics: e.header.topics,
    chart_count: e.charts.length,
  };
}

/** Published entries projected to list rows, relevance-first then title. */
export async function fetchKnowledgeIndex(): Promise<KnowledgeIndexRow[]> {
  const { data, error } = await supabase
    .from('knowledge_entries')
    .select('slug, entry')
    .eq('status', 'published');
  if (error || !data) return [];
  return data
    .map((r) => toIndexRow(r.slug as string, r.entry as KnowledgeEntry))
    .sort((a, b) =>
      (REL_RANK[a.practical_relevance] ?? 3) - (REL_RANK[b.practical_relevance] ?? 3) ||
      a.title.localeCompare(b.title));
}

export async function loadKnowledgeEntry(slug: string): Promise<KnowledgeEntry | null> {
  const { data, error } = await supabase
    .from('knowledge_entries')
    .select('entry')
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle();
  if (error || !data) return null;
  return data.entry as KnowledgeEntry;
}

/** "sprint-intervals" → "sprint intervals" for chip display. */
export function topicLabel(topic: string): string {
  return topic.replace(/-/g, ' ');
}
