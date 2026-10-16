/**
 * knowledge-validate.ts — TypeScript port of src/data/knowledge/build.py's
 * check() for the ingest pipeline. Keep the two in lockstep: build.py
 * validates the founding archive in the repo; this validates every entry a
 * model drafts before it reaches the admin review screen.
 *
 * Errors block an entry from being publishable as-is; warnings ride along
 * in validator_report for the reviewer.
 */

// deno-lint-ignore-file no-explicit-any

import { CHART_TEMPLATES } from "./knowledge-chart-templates.ts";

const SHAPES = new Set(["intervention", "comparison", "review", "reference"]);
const CONF = new Set(["strong", "moderate", "preliminary", "conceptual", "reference"]);
const REL = new Set(["high", "medium", "low"]);
const SIG = new Set(["yes", "no", "not tested", "not reported"]);

/**
 * Does a series item match a template's declared shape?
 * Tokens: 'string' | 'number' | 'any' (key present); a nested array means
 * every element matches the inner shape. The shapes themselves live in
 * src/data/knowledge/chart-templates.json — nothing template-specific here.
 */
function matchesShape(v: any, shape: Record<string, unknown>): boolean {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  for (const [k, tok] of Object.entries(shape)) {
    if (Array.isArray(tok)) {
      if (!Array.isArray(v[k]) || !v[k].every((x: any) => matchesShape(x, tok[0] as Record<string, unknown>))) return false;
    } else if (tok === "string") {
      if (typeof v[k] !== "string") return false;
    } else if (tok === "number") {
      if (typeof v[k] !== "number") return false;
    } else if (!(k in v)) {
      return false;
    }
  }
  return true;
}
const HEADER_KEYS = [
  "title_plain", "citation", "topics", "evidence_type", "confidence",
  "practical_relevance", "author_stance", "funding_and_conflicts",
];
const CITE_KEYS = ["title", "authors", "year", "journal", "volume_issue_pages", "doi"];
const NUM = /\d+(?:[.,]\d+)?/g;

function numbersIn(obj: unknown, out = new Set<string>()): Set<string> {
  if (typeof obj === "string") {
    for (const m of obj.match(NUM) ?? []) out.add(m);
  } else if (typeof obj === "number") {
    out.add(String(obj));
  } else if (Array.isArray(obj)) {
    for (const v of obj) numbersIn(v, out);
  } else if (obj && typeof obj === "object") {
    for (const v of Object.values(obj)) numbersIn(v, out);
  }
  return out;
}

export interface ValidatorReport {
  errors: string[];
  warnings: string[];
}

export function validateKnowledgeEntry(e: any): ValidatorReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  const slug = e?.slug;
  if (!slug || typeof slug !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    errors.push(`slug ${JSON.stringify(slug)} must be kebab-case`);
  }
  if (e?.id !== slug) errors.push("id must equal slug");
  if (!SHAPES.has(e?.shape)) errors.push(`shape ${JSON.stringify(e?.shape)} invalid`);

  const l1 = e?.layer1 ?? {};
  const l1keys = Object.keys(l1);
  if (l1keys.length !== 1 || l1keys[0] !== e?.shape) {
    errors.push(`layer1 keys [${l1keys}] must be exactly ['${e?.shape}']`);
  }

  const h = e?.header ?? {};
  const missing = HEADER_KEYS.filter((k) => !(k in h));
  if (missing.length) errors.push(`header missing ${JSON.stringify(missing)}`);
  const citeKeys = Object.keys(h.citation ?? {}).sort();
  if (JSON.stringify(citeKeys) !== JSON.stringify([...CITE_KEYS].sort())) {
    errors.push("citation keys must be exactly title/authors/year/journal/volume_issue_pages/doi");
  }
  if (!CONF.has(h.confidence?.level)) errors.push(`confidence.level ${JSON.stringify(h.confidence?.level)} invalid`);
  if (!REL.has(h.practical_relevance?.level)) errors.push("practical_relevance.level invalid");
  if ((e?.shape === "intervention" || e?.shape === "comparison") && !h.setup_plain) {
    errors.push("intervention/comparison entries need header.setup_plain (plain-prose overview lede)");
  }
  const kfn = Array.isArray(e?.key_findings) ? e.key_findings.length : 0;
  if (kfn < 3 || kfn > 6) {
    errors.push(`key_findings has ${kfn} bullets (need 3–6: one claim with its number each)`);
  }
  const topicsN = Array.isArray(h.topics) ? h.topics.length : 0;
  if (topicsN < 5 || topicsN > 12) warnings.push(`topics count ${topicsN} outside 5–12`);

  // Structural requirements the page renderer depends on. A draft missing
  // these must never reach review as "0 errors".
  if (!Array.isArray(h.topics)) errors.push("header.topics must be an array");
  if (!Array.isArray(e?.translation)) errors.push("translation must be an array (empty only for pure background papers)");
  if (!Array.isArray(e?.charts) || e.charts.length < 1) errors.push("charts must be an array with at least one chart");
  if (!Array.isArray(e?.verification_notes) || e.verification_notes.length < 1) {
    errors.push("verification_notes must be a non-empty array");
  }
  if (!e?.layer2 || typeof e.layer2.what_it_means !== "string" || !e.layer2.what_it_means ||
      typeof e.layer2.what_it_doesnt_mean !== "string" || !e.layer2.what_it_doesnt_mean) {
    errors.push("layer2 needs non-empty what_it_means and what_it_doesnt_mean");
  }

  const l2 = e?.layer2 ?? {};
  for (const [k, lo, hi] of [["what_it_means", 120, 220], ["what_it_doesnt_mean", 100, 200]] as const) {
    const w = String(l2[k] ?? "").split(/\s+/).filter(Boolean).length;
    if (w < lo * 0.8 || w > hi * 1.2) warnings.push(`${k} is ${w} words (target ${lo}–${hi})`);
  }
  if (!Array.isArray(l2.questions_raised) || l2.questions_raised.length !== 0) {
    warnings.push("questions_raised should be [] (editor fills)");
  }

  // Numbers in Layer 2 must appear in Layer 1 (3+ digit tokens only).
  const l1nums = numbersIn(l1);
  const stray = [...numbersIn(l2)].filter((n) => !l1nums.has(n) && !/^\d{1,2}$/.test(n));
  if (stray.length) warnings.push(`numbers in layer2 not found in layer1: ${stray.slice(0, 12).join(", ")}`);

  for (const row of l1.intervention?.measured ?? []) {
    if (!SIG.has(row?.significant)) {
      errors.push(`measured.significant ${JSON.stringify(row?.significant)} invalid (${row?.outcome})`);
    }
  }

  for (const c of e?.charts ?? []) {
    const t = c?.template;
    const spec = CHART_TEMPLATES[t];
    if (!spec) errors.push(`chart template ${JSON.stringify(t)} invalid`);
    if (t === "concept_curve" && !String(c?.note ?? "").toLowerCase().includes("schematic")) {
      errors.push("concept_curve note must say 'schematic — not measured data'");
    }
    if (t === "stacked_share") {
      for (const s of c?.series ?? []) {
        const tot = (s?.parts ?? []).reduce((a: number, p: any) => a + (p?.value ?? 0), 0);
        if (Math.abs(tot - 100) > 1.5) {
          errors.push(`stacked_share '${s?.label}' parts sum to ${tot}, not 100`);
        }
      }
    }
    // Series must match the template's declared shape (chart-templates.json):
    // a wrong shape here routes the draft through the repair round, so the
    // archive stays canonical even though the renderer also adapts.
    if (spec?.shape) {
      const name = c?.title || t;
      const items: any[] = Array.isArray(c?.series) ? c.series : [];
      if (items.length === 0) {
        errors.push(`chart '${name}': series is empty`);
      } else if (items.some((s) => !matchesShape(s, spec.shape as Record<string, unknown>))) {
        errors.push(`chart '${name}': ${t} series items must be ${spec.shape_text}`);
      }
    }
  }
  if (
    (e?.shape === "intervention" || e?.shape === "comparison") &&
    !(e?.charts ?? []).some((c: any) => c?.template === "population_card")
  ) {
    errors.push("intervention/comparison entries need a population_card chart");
  }

  for (const g of e?.glossary_candidates ?? []) {
    if (g?.confidence_term_is_new !== "likely" && g?.confidence_term_is_new !== "unsure") {
      errors.push(`glossary term ${JSON.stringify(g?.term)} bad confidence_term_is_new`);
    }
  }
  if ((e?.glossary_candidates ?? []).length < 5) warnings.push("fewer than 5 glossary candidates");
  if (
    e?.shape === "review" &&
    !(e?.verification_notes ?? []).some((v: string) => String(v).includes("not verified against originals"))
  ) {
    errors.push("review entries need the second-hand flag line in verification_notes");
  }

  return { errors, warnings };
}
