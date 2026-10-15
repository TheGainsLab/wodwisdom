#!/usr/bin/env python3
"""Validate entries/*.json against the v0 contract, then build index.json and glossary.json.

Usage: python3 build.py            # validate + build
       python3 build.py --check    # validate only, non-zero exit on failure
"""
import json, re, sys, glob, os
from collections import OrderedDict

ROOT = os.path.dirname(os.path.abspath(__file__))
ENTRIES = sorted(glob.glob(os.path.join(ROOT, "entries", "*.json")))

SHAPES = {"intervention", "comparison", "review", "reference"}
CONF = {"strong", "moderate", "preliminary", "conceptual", "reference"}
REL = {"high", "medium", "low"}
SIG = {"yes", "no", "not tested", "not reported"}
TEMPLATES = {"before_after_bars", "grouped_change_bars", "values_by_condition",
             "stacked_share", "timeline", "population_card", "concept_curve"}
HEADER_KEYS = {"title_plain", "citation", "topics", "evidence_type", "confidence",
               "practical_relevance", "author_stance", "funding_and_conflicts"}
CITE_KEYS = {"title", "authors", "year", "journal", "volume_issue_pages", "doi"}
NUM = re.compile(r"\d+(?:[.,]\d+)?")


def numbers_in(obj):
    """All numeric tokens in any string inside obj."""
    out = set()
    if isinstance(obj, str):
        out.update(NUM.findall(obj))
    elif isinstance(obj, dict):
        for v in obj.values():
            out |= numbers_in(v)
    elif isinstance(obj, list):
        for v in obj:
            out |= numbers_in(v)
    elif isinstance(obj, (int, float)):
        out.add(str(obj))
    return out


def check(e, path):
    errs, warns = [], []
    name = os.path.basename(path)
    slug = name[:-5]
    if e.get("id") != slug or e.get("slug") != slug:
        errs.append(f"id/slug must equal filename stem '{slug}'")
    if e.get("shape") not in SHAPES:
        errs.append(f"shape {e.get('shape')!r} not in {sorted(SHAPES)}")
    l1 = e.get("layer1", {})
    if set(l1.keys()) != {e.get("shape")}:
        errs.append(f"layer1 keys {sorted(l1.keys())} must be exactly ['{e.get('shape')}']")
    h = e.get("header", {})
    missing = HEADER_KEYS - set(h)
    if missing:
        errs.append(f"header missing {sorted(missing)}")
    if set(h.get("citation", {})) != CITE_KEYS:
        errs.append("citation keys must be exactly title/authors/year/journal/volume_issue_pages/doi")
    if h.get("confidence", {}).get("level") not in CONF:
        errs.append(f"confidence.level {h.get('confidence', {}).get('level')!r} invalid")
    if h.get("practical_relevance", {}).get("level") not in REL:
        errs.append(f"practical_relevance.level invalid")
    if e.get("shape") in ("intervention", "comparison") and not h.get("setup_plain"):
        errs.append("intervention/comparison entries need header.setup_plain (plain-prose overview lede)")
    kfn = len(e.get("key_findings", []))
    if not (3 <= kfn <= 6):
        errs.append(f"key_findings has {kfn} bullets (need 3–6: one claim with its number each)")
    if not (5 <= len(h.get("topics", [])) <= 12):
        warns.append(f"topics count {len(h.get('topics', []))} outside 5–12")
    l2 = e.get("layer2", {})
    for k in ("what_it_means", "what_it_doesnt_mean"):
        w = len(l2.get(k, "").split())
        lo, hi = (120, 220) if k == "what_it_means" else (100, 200)
        if not (lo * 0.8 <= w <= hi * 1.2):
            warns.append(f"{k} is {w} words (target {lo}–{hi})")
    if l2.get("questions_raised") != []:
        warns.append("questions_raised should be [] in v0 (editor fills)")
    # numbers in layer 2 must appear in layer 1
    l1nums = numbers_in(l1)
    stray = numbers_in(l2) - l1nums
    stray = {n for n in stray if not re.fullmatch(r"\d{1,2}", n)}  # ignore small counts like "8 weeks" -> still flagged if >2 digits
    if stray:
        warns.append(f"numbers in layer2 not found in layer1: {sorted(stray)[:12]}")
    # measured rows
    for row in l1.get("intervention", {}).get("measured", []):
        if row.get("significant") not in SIG:
            errs.append(f"measured.significant {row.get('significant')!r} invalid ({row.get('outcome')})")
    # charts
    for c in e.get("charts", []):
        if c.get("template") not in TEMPLATES:
            errs.append(f"chart template {c.get('template')!r} invalid")
        if c.get("template") == "concept_curve" and "schematic" not in c.get("note", "").lower():
            errs.append("concept_curve note must say 'schematic — not measured data'")
        if c.get("template") == "stacked_share":
            for s in c.get("series", []):
                tot = sum(p.get("value", 0) for p in s.get("parts", []))
                if abs(tot - 100) > 1.5:
                    errs.append(f"stacked_share '{s.get('label')}' parts sum to {tot}, not 100")
    if e["shape"] in ("intervention", "comparison") and not any(
            c.get("template") == "population_card" for c in e.get("charts", [])):
        errs.append("intervention/comparison entries need a population_card chart")
    # glossary
    for g in e.get("glossary_candidates", []):
        if g.get("confidence_term_is_new") not in {"likely", "unsure"}:
            errs.append(f"glossary term {g.get('term')!r} bad confidence_term_is_new")
    if len(e.get("glossary_candidates", [])) < 5:
        warns.append("fewer than 5 glossary candidates")
    if e["shape"] == "review" and not any("not verified against originals" in v for v in e.get("verification_notes", [])):
        errs.append("review entries need the second-hand flag line in verification_notes")
    return errs, warns


def norm(term):
    return re.sub(r"[^a-z0-9]+", " ", term.lower()).strip()


def main():
    check_only = "--check" in sys.argv
    entries, failed = [], False
    for p in ENTRIES:
        try:
            e = json.load(open(p))
        except Exception as ex:
            print(f"✗ {os.path.basename(p)}: invalid JSON: {ex}")
            failed = True
            continue
        errs, warns = check(e, p)
        tag = "✗" if errs else "✓"
        print(f"{tag} {os.path.basename(p)}")
        for m in errs:
            print(f"    ERROR {m}")
        for m in warns:
            print(f"    warn  {m}")
        if errs:
            failed = True
        entries.append(e)
    if check_only:
        sys.exit(1 if failed else 0)
    if failed:
        print("\nNot building index/glossary while errors remain.")
        sys.exit(1)

    # index.json — the list page and topic search read this, not the entries
    index = []
    for e in entries:
        h = e["header"]
        index.append(OrderedDict(
            id=e["id"], slug=e["slug"], title=h["title_plain"],
            paper_title=h["citation"]["title"],
            authors=h["citation"]["authors"], year=h["citation"]["year"], journal=h["citation"]["journal"],
            shape=e["shape"], confidence=h["confidence"]["level"],
            practical_relevance=h["practical_relevance"]["level"],
            topics=h["topics"], chart_count=len(e.get("charts", [])),
        ))
    rel_rank = {"high": 0, "medium": 1, "low": 2}
    index.sort(key=lambda r: (rel_rank[r["practical_relevance"]], r["title"]))
    json.dump(index, open(os.path.join(ROOT, "index.json"), "w"), indent=2, ensure_ascii=False)

    # glossary.json — one row per term, first definition wins, all sources listed
    glossary = OrderedDict()
    for e in entries:
        for g in e.get("glossary_candidates", []):
            k = norm(g["term"])
            if k in glossary:
                glossary[k]["sources"].append(e["id"])
                glossary[k]["alt_definitions"].append({"entry": e["id"], "definition": g["definition"]})
            else:
                glossary[k] = OrderedDict(term=g["term"], definition=g["definition"],
                                          status="candidate", sources=[e["id"]], alt_definitions=[])
    rows = sorted(glossary.values(), key=lambda r: r["term"].lower())
    json.dump(rows, open(os.path.join(ROOT, "glossary.json"), "w"), indent=2, ensure_ascii=False)

    topics = {}
    for r in index:
        for t in r["topics"]:
            topics.setdefault(t, []).append(r["id"])
    json.dump(OrderedDict(sorted(topics.items())), open(os.path.join(ROOT, "topics.json"), "w"), indent=2, ensure_ascii=False)

    dup = sum(1 for r in rows if r["alt_definitions"])
    print(f"\nindex.json: {len(index)} entries · glossary.json: {len(rows)} terms ({dup} with alternate definitions to reconcile) · topics.json: {len(topics)} topics")


if __name__ == "__main__":
    main()
