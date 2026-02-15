#!/usr/bin/env python3
"""
Parse the OCR'd CrossFit Kids Training Guide into sections and ingest each
into the WodWisdom vector store.

Usage:
  INGEST_SECRET=xxx python scripts/ingest_kids.py
  INGEST_SECRET=xxx python scripts/ingest_kids.py --endpoint http://localhost:54321/functions/v1/ingest
"""

import argparse
import json
import os
import re
import sys

import requests

INGEST_ENDPOINT = os.getenv(
    "INGEST_ENDPOINT",
    "https://hsiqzmbfulmfxbvbsdwz.supabase.co/functions/v1/ingest",
)
INGEST_SECRET = os.getenv("INGEST_SECRET", "")

# OCR artifacts to strip
PAGE_HEADER_RE = re.compile(
    r"^(METHODOLOGY|MOVEMENTS|POST-COURSE RESOURCES?)\s+CrossFit Kids Training Guide\s*\|\s*CrossFit\s*$",
    re.MULTILINE,
)
PAGE_FOOTER_RE = re.compile(
    r"^\|?\s*CrossFit\s+CrossFit Kids Training Guide\s*\|\s*\d+\s+of\s+\d+\s*$",
    re.MULTILINE,
)
COPYRIGHT_RE = re.compile(
    r"^Copyright © \d{4} CrossFit, LLC\. All Rights Reserved\.\s*$", re.MULTILINE
)
VERSION_RE = re.compile(r"^\d+\.\d+-\d+\w+\s*$", re.MULTILINE)
CROSSFIT_LOGO_RE = re.compile(r"^«?\s*[Cc]ross[Ff]it\s*$", re.MULTILINE)
PAGE_NUM_RE = re.compile(
    r"^CrossFit Kids Training Guide\s*\|\s*\d+\s+of\s+\d+\s*$", re.MULTILINE
)
CONTINUED_HEADER_RE = re.compile(
    r"^(CrossFit Kids Science|CrossFit Kids Nutrition and Lifestyle[^,]*|Movements|Protecting CrossFit Kids From Predation|Frequently Asked Questions|Equipment List|Class Structure),\s*continued\s*$",
    re.MULTILINE,
)


def clean_ocr_text(text: str) -> str:
    """Remove OCR headers, footers, copyright notices, and other artifacts."""
    text = PAGE_HEADER_RE.sub("", text)
    text = PAGE_FOOTER_RE.sub("", text)
    text = COPYRIGHT_RE.sub("", text)
    text = VERSION_RE.sub("", text)
    text = CROSSFIT_LOGO_RE.sub("", text)
    text = PAGE_NUM_RE.sub("", text)
    text = CONTINUED_HEADER_RE.sub("", text)
    # Collapse excessive blank lines
    text = re.sub(r"\n{4,}", "\n\n\n", text)
    return text.strip()


# Define section boundaries by line-number ranges (approximate from OCR analysis)
SECTIONS = [
    {
        "title": "CrossFit Kids Science - Introduction and Research",
        "start_line": 53,
        "end_line": 270,
        "category": "kids",
        "author": "CrossFit Kids",
        "source": "CrossFit Kids Training Guide",
    },
    {
        "title": "CrossFit Kids - Class Structure and Learning Environment",
        "start_line": 270,
        "end_line": 520,
        "category": "kids",
        "author": "CrossFit Kids",
        "source": "CrossFit Kids Training Guide",
    },
    {
        "title": "CrossFit Kids Science - Motor Development and Physical Literacy",
        "start_line": 520,
        "end_line": 800,
        "category": "kids",
        "author": "CrossFit Kids",
        "source": "CrossFit Kids Training Guide",
    },
    {
        "title": "CrossFit Kids Science - Exercise and Brain Development",
        "start_line": 800,
        "end_line": 1100,
        "category": "kids",
        "author": "CrossFit Kids",
        "source": "CrossFit Kids Training Guide",
    },
    {
        "title": "CrossFit Kids Science - Resistance Training for Youth",
        "start_line": 1100,
        "end_line": 1420,
        "category": "kids",
        "author": "CrossFit Kids",
        "source": "CrossFit Kids Training Guide",
    },
    {
        "title": "CrossFit Kids Science - Bone Health and Vestibular System",
        "start_line": 1420,
        "end_line": 1720,
        "category": "kids",
        "author": "CrossFit Kids",
        "source": "CrossFit Kids Training Guide",
    },
    {
        "title": "CrossFit Kids - Optimizing the Learning Environment",
        "start_line": 1720,
        "end_line": 2310,
        "category": "kids",
        "author": "CrossFit Kids",
        "source": "CrossFit Kids Training Guide",
    },
    {
        "title": "CrossFit Kids Nutrition and Lifestyle",
        "start_line": 2310,
        "end_line": 2850,
        "category": "kids",
        "author": "CrossFit Kids",
        "source": "CrossFit Kids Training Guide",
    },
    {
        "title": "CrossFit Kids - Movement: Squat",
        "start_line": 5483,
        "end_line": 5700,
        "category": "kids",
        "author": "CrossFit Kids",
        "source": "CrossFit Kids Training Guide",
    },
    {
        "title": "CrossFit Kids - Movement: Front Squat",
        "start_line": 5700,
        "end_line": 5780,
        "category": "kids",
        "author": "CrossFit Kids",
        "source": "CrossFit Kids Training Guide",
    },
    {
        "title": "CrossFit Kids - Movement: Overhead Squat",
        "start_line": 5780,
        "end_line": 5855,
        "category": "kids",
        "author": "CrossFit Kids",
        "source": "CrossFit Kids Training Guide",
    },
    {
        "title": "CrossFit Kids - Movement: Press",
        "start_line": 5855,
        "end_line": 5975,
        "category": "kids",
        "author": "CrossFit Kids",
        "source": "CrossFit Kids Training Guide",
    },
    {
        "title": "CrossFit Kids - Movement: Thruster",
        "start_line": 5975,
        "end_line": 6060,
        "category": "kids",
        "author": "CrossFit Kids",
        "source": "CrossFit Kids Training Guide",
    },
    {
        "title": "CrossFit Kids - Movement: Push Press",
        "start_line": 6060,
        "end_line": 6130,
        "category": "kids",
        "author": "CrossFit Kids",
        "source": "CrossFit Kids Training Guide",
    },
    {
        "title": "CrossFit Kids - Movement: Push Jerk",
        "start_line": 6130,
        "end_line": 6265,
        "category": "kids",
        "author": "CrossFit Kids",
        "source": "CrossFit Kids Training Guide",
    },
    {
        "title": "CrossFit Kids - Movement: Deadlift",
        "start_line": 6265,
        "end_line": 6418,
        "category": "kids",
        "author": "CrossFit Kids",
        "source": "CrossFit Kids Training Guide",
    },
    {
        "title": "CrossFit Kids - Movement: Sumo Deadlift High Pull",
        "start_line": 6418,
        "end_line": 6525,
        "category": "kids",
        "author": "CrossFit Kids",
        "source": "CrossFit Kids Training Guide",
    },
    {
        "title": "CrossFit Kids - Movement: Hang Power Clean",
        "start_line": 6525,
        "end_line": 6607,
        "category": "kids",
        "author": "CrossFit Kids",
        "source": "CrossFit Kids Training Guide",
    },
    {
        "title": "CrossFit Kids - Movement: Pull-Up, Push-Up, and Handstand Push-Up",
        "start_line": 6607,
        "end_line": 6870,
        "category": "kids",
        "author": "CrossFit Kids",
        "source": "CrossFit Kids Training Guide",
    },
    {
        "title": "CrossFit Kids - Safety Guidelines",
        "start_line": 6865,
        "end_line": 6970,
        "category": "kids",
        "author": "CrossFit Kids",
        "source": "CrossFit Kids Training Guide",
    },
    {
        "title": "CrossFit Kids - Class Structure: Preschool, Kids, and Teens",
        "start_line": 6967,
        "end_line": 7140,
        "category": "kids",
        "author": "CrossFit Kids",
        "source": "CrossFit Kids Training Guide",
    },
    {
        "title": "CrossFit Kids - Equipment List and Scaling",
        "start_line": 7138,
        "end_line": 7275,
        "category": "kids",
        "author": "CrossFit Kids",
        "source": "CrossFit Kids Training Guide",
    },
    {
        "title": "CrossFit Kids - Frequently Asked Questions",
        "start_line": 7272,
        "end_line": 7510,
        "category": "kids",
        "author": "CrossFit Kids",
        "source": "CrossFit Kids Training Guide",
    },
    {
        "title": "Protecting CrossFit Kids from Predation",
        "start_line": 5121,
        "end_line": 5483,
        "category": "kids",
        "author": "CrossFit Kids",
        "source": "CrossFit Kids Training Guide",
    },
]


def send_to_ingest(payload: dict, endpoint: str, secret: str) -> dict:
    """POST the article payload to the ingest edge function."""
    resp = requests.post(
        endpoint,
        headers={
            "Authorization": f"Bearer {secret}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()


def main():
    parser = argparse.ArgumentParser(
        description="Ingest CrossFit Kids Training Guide into WodWisdom"
    )
    parser.add_argument(
        "--endpoint", default=INGEST_ENDPOINT, help="Ingest endpoint URL"
    )
    parser.add_argument("--secret", default=INGEST_SECRET, help="Ingest secret")
    parser.add_argument(
        "--input",
        default="TG_Online_Kids.txt",
        help="Path to OCR'd text file",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print sections without ingesting",
    )
    args = parser.parse_args()

    if not args.dry_run and not args.secret:
        print("Error: Set INGEST_SECRET env var or pass --secret")
        sys.exit(1)

    # Read the full OCR text
    with open(args.input, "r") as f:
        lines = f.readlines()

    print(f"Read {len(lines)} lines from {args.input}")

    success_count = 0
    error_count = 0

    for section in SECTIONS:
        # Extract lines (1-indexed in the file, 0-indexed in array)
        start = section["start_line"] - 1
        end = section["end_line"]
        raw_text = "".join(lines[start:end])

        # Clean OCR artifacts
        cleaned = clean_ocr_text(raw_text)

        if not cleaned.strip():
            print(f"  SKIP (empty): {section['title']}")
            continue

        print(f"\n--- {section['title']} ---")
        print(f"  Lines {section['start_line']}-{section['end_line']}")
        print(f"  Chars: {len(cleaned):,}")

        if args.dry_run:
            # Show first 200 chars
            preview = cleaned[:200].replace("\n", " ")
            print(f"  Preview: {preview}...")
            continue

        payload = {
            "title": section["title"],
            "author": section.get("author"),
            "category": section.get("category", "kids"),
            "source": section.get("source", "CrossFit Kids Training Guide"),
            "content": cleaned,
        }

        try:
            result = send_to_ingest(payload, args.endpoint, args.secret)
            print(
                f"  Ingested: {result.get('chunks_ingested', '?')} chunks, "
                f"~{result.get('total_tokens', '?')} tokens"
            )
            success_count += 1
        except Exception as e:
            print(f"  ERROR: {e}")
            error_count += 1

    print(f"\nDone! {success_count} sections ingested, {error_count} errors.")


if __name__ == "__main__":
    main()
