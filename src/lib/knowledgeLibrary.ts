/**
 * /knowledge v0 — data access for the research library.
 *
 * The corpus ships as static JSON in src/data/knowledge (twelve hand-built
 * entries, a topic index, and a candidate glossary — see the design handoff
 * and data/knowledge/README provenance). No DB, no auth: the content is free
 * by construction; only the future "Discuss this paper" chat is gated.
 *
 * index/topics load eagerly (small); full entries load lazily per slug so
 * the corpus doesn't ride in the main bundle.
 */

import indexJson from '../data/knowledge/index.json';
import topicsJson from '../data/knowledge/topics.json';
import glossaryJson from '../data/knowledge/glossary.json';

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

export const KNOWLEDGE_INDEX = indexJson as KnowledgeIndexRow[];
export const KNOWLEDGE_TOPICS = topicsJson as Record<string, string[]>;
export const KNOWLEDGE_GLOSSARY = glossaryJson as GlossaryTerm[];

// Lazy per-entry loading: each entry becomes its own chunk.
const entryModules = import.meta.glob('../data/knowledge/entries/*.json');

export async function loadKnowledgeEntry(slug: string): Promise<KnowledgeEntry | null> {
  const key = `../data/knowledge/entries/${slug}.json`;
  const loader = entryModules[key];
  if (!loader) return null;
  const mod = (await loader()) as { default: KnowledgeEntry };
  return mod.default;
}

export function knowledgeIndexRow(slug: string): KnowledgeIndexRow | undefined {
  return KNOWLEDGE_INDEX.find((r) => r.slug === slug);
}

/** "sprint-intervals" → "sprint intervals" for chip display. */
export function topicLabel(topic: string): string {
  return topic.replace(/-/g, ' ');
}
