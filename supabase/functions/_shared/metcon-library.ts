/**
 * metcon-library.ts — what the library gives the metcon planner and composer.
 *
 * Two things, both read straight from the database (no search, no AI):
 *
 *   1. EXAMPLES: real main site metcons, cleaned to the workout itself
 *      (mainsite_examples, filled once by clean-mainsite-examples). A fresh
 *      random draw of 100 on every build. They show what a well-written
 *      workout looks like: format, layout, how movements are paired, how reps
 *      and loads are stated (founder, 2026-11-27: "We're using the workouts
 *      to show what well-written workouts look like"). They are not written
 *      for the member and are not to be copied.
 *
 *   2. ARTICLES: the CrossFit Journal articles the founder chose. The planner
 *      reads the Theoretical Template; the composer reads that plus Metabolic
 *      Conditioning and Benchmark Workouts.
 *
 * This replaces the twelve examples that six frozen search queries used to
 * fetch (metcon-examples.ts, removed).
 *
 * Every failure is soft: the build runs without the text and the miss is
 * logged, so a library problem never stops a member's program.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const EXAMPLE_DRAW = 100;

/** Library titles, exactly as stored in chunks.title. */
export const ARTICLE_TITLES = {
  template: "06 03 CF Template",
  metabolic_conditioning: "Metabolic Conditioning English",
  benchmark_workouts: "13 03 Benchmark Workouts",
} as const;
export type ArticleKey = keyof typeof ARTICLE_TITLES;

/** What the reader is told each article is. */
const ARTICLE_NAMES: Record<ArticleKey, string> = {
  template: "A Theoretical Template for CrossFit's Programming (Greg Glassman, CrossFit Journal, February 2003)",
  metabolic_conditioning: "Metabolic Conditioning (Greg Glassman, CrossFit Journal, June 2003)",
  benchmark_workouts: "Benchmark Workouts (Greg Glassman, CrossFit Journal, September 2003)",
};

export const PLANNER_ARTICLES: ArticleKey[] = ["template"];
export const COMPOSER_ARTICLES: ArticleKey[] = ["template", "metabolic_conditioning", "benchmark_workouts"];

export interface ExampleRow {
  workout_date?: string | null;
  kind?: string | null;
  name?: string | null;
  text: string;
}

/** Pure: the examples as one block of text. "" when there are none. */
export function renderExamples(rows: ExampleRow[]): string {
  const usable = rows.filter((r) => (r?.text ?? "").trim() !== "");
  if (usable.length === 0) return "";
  return (
    `EXAMPLE WORKOUTS (${usable.length} real CrossFit main site metcons, drawn at random). ` +
    `They show what a well-written workout looks like: its format, how it is laid out, how movements are paired, ` +
    `and how reps and loads are stated. They were not written for this athlete. Write this athlete's workouts ` +
    `from what you are told about them; do not copy an example and do not pick one to adapt.\n\n` +
    usable.map((r) => r.text.trim()).join("\n\n---\n\n")
  );
}

/** Pure: an article's stored pieces joined in order. The library stores an
 *  article in pieces that each repeat the last ~200 characters of the one
 *  before; the repeat is dropped so the text reads once. */
export function joinArticle(pieces: Array<{ chunk_index?: number | null; content?: string | null }>): string {
  const ordered = [...pieces]
    .sort((a, b) => (a.chunk_index ?? 0) - (b.chunk_index ?? 0))
    .map((p) => p.content ?? "")
    .filter((c) => c.trim() !== "");
  let out = "";
  for (const piece of ordered) {
    let overlap = 0;
    for (let n = Math.min(out.length, piece.length, 400); n >= 20; n--) {
      if (out.endsWith(piece.slice(0, n))) { overlap = n; break; }
    }
    out += piece.slice(overlap);
  }
  return out.trim();
}

/** Pure: the articles as one block of text. "" when none loaded. */
export function renderArticles(articles: Array<{ key: ArticleKey; text: string }>): string {
  const usable = articles.filter((a) => a.text.trim() !== "");
  if (usable.length === 0) return "";
  return (
    `REFERENCE ARTICLES (background on how CrossFit programming and conditioning work; ` +
    `where one disagrees with your instructions, your instructions win):\n\n` +
    usable.map((a) => `=== ${ARTICLE_NAMES[a.key]} ===\n${a.text.trim()}`).join("\n\n")
  );
}

/** A fresh random draw of real main site metcons. "" on any failure. */
export async function loadExampleBlock(supa: SupabaseClient, n: number = EXAMPLE_DRAW): Promise<string> {
  try {
    const { data, error } = await supa.rpc("sample_mainsite_examples", { n });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as ExampleRow[];
    if (rows.length === 0) {
      console.warn("[metcon-library] no example workouts stored: the composer runs with none");
      return "";
    }
    console.log(`[metcon-library] ${rows.length} example workouts drawn`);
    return renderExamples(rows);
  } catch (e) {
    console.error("[metcon-library] example draw failed (continuing without):", e instanceof Error ? e.message : String(e));
    return "";
  }
}

/** The named articles, in the order given. "" on any failure. */
export async function loadArticleBlock(supa: SupabaseClient, keys: ArticleKey[]): Promise<string> {
  try {
    const out: Array<{ key: ArticleKey; text: string }> = [];
    for (const key of keys) {
      const { data, error } = await supa
        .from("chunks")
        .select("chunk_index, content")
        .eq("title", ARTICLE_TITLES[key])
        .order("chunk_index", { ascending: true });
      if (error) throw new Error(error.message);
      const text = joinArticle((data ?? []) as Array<{ chunk_index: number; content: string }>);
      if (!text) console.warn(`[metcon-library] article "${ARTICLE_TITLES[key]}" not found in the library`);
      out.push({ key, text });
    }
    return renderArticles(out);
  } catch (e) {
    console.error("[metcon-library] article load failed (continuing without):", e instanceof Error ? e.message : String(e));
    return "";
  }
}
