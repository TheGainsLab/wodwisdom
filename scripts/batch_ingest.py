#!/usr/bin/env python3
"""Batch ingest a curated list of articles into WodWisdom."""

import os
import sys
import time

# Add parent so we can import from ingest
sys.path.insert(0, os.path.dirname(__file__))
from ingest import (
    download_pdf,
    extract_web_text,
    is_pdf_url,
    normalize_url,
    send_to_ingest,
)

INGEST_ENDPOINT = os.getenv(
    "INGEST_ENDPOINT",
    "https://hsiqzmbfulmfxbvbsdwz.supabase.co/functions/v1/ingest",
)
INGEST_SECRET = os.getenv("INGEST_SECRET", "")

# Each entry: (url, title, category, source)
ARTICLES = [
    # ── Physiology / Research ──────────────────────────────────────────
    (
        "https://journal.crossfit.com/article/vo2-max-not-the-gold-standard-2",
        "VO2 Max: Not the Gold Standard",
        "physiology",
        "CrossFit Journal",
    ),
    (
        "https://journal.crossfit.com/article/the-paradox-of-the-aerobic-fitness-prescription-2",
        "The Paradox of the Aerobic Fitness Prescription",
        "physiology",
        "CrossFit Journal",
    ),
    (
        "https://journal.crossfit.com/article/anatomy-and-physiology-2",
        "Anatomy and Physiology",
        "physiology",
        "CrossFit Journal",
    ),
    (
        "https://journal.crossfit.com/article/spine-mechanics-for-lifters-2",
        "Spine Mechanics for Lifters",
        "physiology",
        "CrossFit Journal",
    ),
    (
        "http://www.academia.edu/23698675/",
        "Academia: CrossFit Research",
        "physiology",
        "Academia.edu",
    ),
    (
        "https://bjsm.bmj.com/content/bjsports/51/4/211.full.pdf",
        "Sport and Exercise Medicine Research (BJSM)",
        "physiology",
        "British Journal of Sports Medicine",
    ),

    # ── CrossFit Journal – Programming & Training ─────────────────────
    (
        "https://journal.crossfit.com/article/human-power-output-and-crossfit-metcon-workouts-2",
        "Human Power Output and CrossFit Metcon Workouts",
        "journal",
        "CrossFit Journal",
    ),
    (
        "http://journal.crossfit.com/2010/09/cpc-macromicro.tpl",
        "Macro and Micro Programming",
        "journal",
        "CrossFit Journal",
    ),
    (
        "https://journal.crossfit.com/article/building-mental-toughness-2",
        "Building Mental Toughness",
        "journal",
        "CrossFit Journal",
    ),
    (
        "https://journal.crossfit.com/article/value-kilgore-2",
        "The Value of CrossFit Training",
        "journal",
        "CrossFit Journal",
    ),

    # ── CrossFit Journal – Movements & Gymnastics ─────────────────────
    (
        "https://journal.crossfit.com/article/cfj-applications-of-the-support-on-rings",
        "Applications of the Support on Rings",
        "journal",
        "CrossFit Journal",
    ),
    (
        "https://journal.crossfit.com/article/forcing-the-issue",
        "Forcing the Issue",
        "journal",
        "CrossFit Journal",
    ),
    (
        "https://journal.crossfit.com/article/getting-inverted",
        "Getting Inverted",
        "journal",
        "CrossFit Journal",
    ),
    (
        "https://journal.crossfit.com/article/getting-some-leverage-2",
        "Getting Some Leverage",
        "journal",
        "CrossFit Journal",
    ),
    (
        "https://journal.crossfit.com/article/safety-and-efficacy-of-overhead-lifting",
        "Safety and Efficacy of Overhead Lifting",
        "journal",
        "CrossFit Journal",
    ),
    (
        "https://journal.crossfit.com/article/cfj-the-athletic-hip",
        "The Athletic Hip",
        "journal",
        "CrossFit Journal",
    ),
    (
        "https://journal.crossfit.com/article/cfj-the-scoop-and-the-second-pull",
        "The Scoop and the Second Pull",
        "journal",
        "CrossFit Journal",
    ),
    (
        "https://journal.crossfit.com/article/the-role-of-bench-press-in-strength-training-2",
        "The Role of Bench Press in Strength Training",
        "journal",
        "CrossFit Journal",
    ),
    (
        "https://journal.crossfit.com/article/where-barbells-come-from",
        "Where Barbells Come From",
        "journal",
        "CrossFit Journal",
    ),
    (
        "https://journal.crossfit.com/article/charter-degain",
        "Charter: Degain",
        "journal",
        "CrossFit Journal",
    ),

    # ── CrossFit Journal – Nutrition ──────────────────────────────────
    (
        "https://journal.crossfit.com/article/calories-giardina-2",
        "Calories",
        "journal",
        "CrossFit Journal",
    ),
    (
        "https://journal.crossfit.com/article/milking-fact-from-intolerance-2",
        "Milking Fact From Intolerance",
        "journal",
        "CrossFit Journal",
    ),
    (
        "https://journal.crossfit.com/article/my-experiments-with-intermittent-fasting-2",
        "My Experiments With Intermittent Fasting",
        "journal",
        "CrossFit Journal",
    ),
    (
        "https://journal.crossfit.com/article/nutrition-brief-pros-and-cons-of-intermittent-fasting-2",
        "Nutrition Brief: Pros and Cons of Intermittent Fasting",
        "journal",
        "CrossFit Journal",
    ),
    (
        "https://journal.crossfit.com/article/race-day-fueling",
        "Race Day Fueling",
        "journal",
        "CrossFit Journal",
    ),
    (
        "http://library.crossfit.com/free/pdf/CFJ_2015_07_Sugar_Beers6.pdf",
        "Sugar",
        "journal",
        "CrossFit Journal",
    ),
    (
        "http://library.crossfit.com/free/pdf/CFJ_2016_06_Cancer-Saline4.pdf",
        "Cancer and Saline",
        "journal",
        "CrossFit Journal",
    ),

    # ── CrossFit Journal – Health & Lifestyle ─────────────────────────
    (
        "https://journal.crossfit.com/article/high-performance-pregnancy-2",
        "High-Performance Pregnancy",
        "journal",
        "CrossFit Journal",
    ),
    (
        "https://journal.crossfit.com/article/make-your-life-better-get-horizontal-2",
        "Make Your Life Better: Get Horizontal",
        "journal",
        "CrossFit Journal",
    ),
    (
        "https://journal.crossfit.com/article/skin-infections-and-the-crossfit-athlete",
        "Skin Infections and the CrossFit Athlete",
        "journal",
        "CrossFit Journal",
    ),

    # ── CrossFit Journal – Safety & Business ──────────────────────────
    (
        "https://journal.crossfit.com/article/injury-galligani-2",
        "Injury",
        "journal",
        "CrossFit Journal",
    ),
    (
        "https://journal.crossfit.com/article/protecting-your-business-the-waiver-2",
        "Protecting Your Business: The Waiver",
        "journal",
        "CrossFit Journal",
    ),
    (
        "https://journal.crossfit.com/article/safety-for-athletes-and-trainers",
        "Safety for Athletes and Trainers",
        "journal",
        "CrossFit Journal",
    ),

    # ── CrossFit Certification ────────────────────────────────────────
    (
        "https://assets.crossfit.com/pdfs/certifications/CCFT_CandidateHandbook.pdf",
        "CCFT Candidate Handbook",
        "journal",
        "CrossFit",
    ),
]


def main():
    if not INGEST_SECRET:
        print("Error: Set INGEST_SECRET env var")
        sys.exit(1)

    total = len(ARTICLES)
    succeeded = 0
    failed = []

    print(f"=== Batch ingesting {total} articles ===\n")

    for i, (url, title, category, source) in enumerate(ARTICLES, 1):
        print(f"[{i}/{total}] {title}")
        print(f"  URL: {url}")

        try:
            # Normalize URL (e.g. PMC PDF → HTML)
            target = normalize_url(url)

            # Fetch content
            if is_pdf_url(target):
                auto_title, content = download_pdf(target)
            else:
                auto_title, content = extract_web_text(target)

            if not content.strip():
                print("  WARNING: No text extracted, skipping.\n")
                failed.append((title, "No text extracted"))
                continue

            print(f"  Extracted {len(content):,} chars")

            payload = {
                "title": title,
                "category": category,
                "source": source,
                "source_url": url,
                "content": content,
            }

            result = send_to_ingest(payload, INGEST_ENDPOINT, INGEST_SECRET)
            chunks = result.get("chunks_ingested", "?")
            tokens = result.get("total_tokens", "?")
            print(f"  OK: {chunks} chunks, ~{tokens} tokens\n")
            succeeded += 1

        except Exception as e:
            print(f"  ERROR: {e}\n")
            failed.append((title, str(e)))

        # Small delay to be kind to APIs
        time.sleep(1)

    print(f"\n=== Done: {succeeded}/{total} succeeded ===")
    if failed:
        print(f"\nFailed ({len(failed)}):")
        for title, err in failed:
            print(f"  - {title}: {err}")


if __name__ == "__main__":
    main()
