#!/usr/bin/env python3
"""
Ingest articles (PDFs or web URLs) into WodWisdom.

Usage:
  python scripts/ingest.py article.pdf
  python scripts/ingest.py https://journal.crossfit.com/article/some-article
  python scripts/ingest.py ./pdfs/            # whole folder of PDFs

Optional flags:
  --title "..."       Override auto-detected title
  --author "..."      Article author
  --category "..."    e.g. journal, physiology, movement
  --source "..."      e.g. CrossFit Journal
  --source-url "..."  Link to original article
  --endpoint URL      Override ingest endpoint
  --secret SECRET     Override INGEST_SECRET (or set env var)
"""

import argparse
import json
import os
import sys
from pathlib import Path

import requests
from bs4 import BeautifulSoup
from pypdf import PdfReader


INGEST_ENDPOINT = os.getenv(
    "INGEST_ENDPOINT",
    "https://hsiqzmbfulmfxbvbsdwz.supabase.co/functions/v1/ingest",
)
INGEST_SECRET = os.getenv("INGEST_SECRET", "")


def extract_pdf_text(path: str) -> str:
    """Extract all text from a PDF file."""
    reader = PdfReader(path)
    pages = []
    for page in reader.pages:
        text = page.extract_text()
        if text:
            pages.append(text.strip())
    return "\n\n".join(pages)


def extract_web_text(url: str) -> tuple[str, str]:
    """Fetch a URL and return (title, body text)."""
    resp = requests.get(url, timeout=30, headers={"User-Agent": "WodWisdom-Ingest/1.0"})
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    # Remove script/style elements
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()

    title = soup.title.string.strip() if soup.title and soup.title.string else ""

    # Try to find the article body
    article = soup.find("article") or soup.find("main") or soup.find("body")
    text = article.get_text(separator="\n", strip=True) if article else soup.get_text(separator="\n", strip=True)

    return title, text


def guess_title_from_pdf(path: str) -> str:
    """Use the filename as a fallback title."""
    return Path(path).stem.replace("-", " ").replace("_", " ").title()


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


def prompt_metadata(auto_title: str) -> dict:
    """Interactively ask the user for article metadata."""
    print(f"\n  Auto-detected title: {auto_title}")
    title = input(f"  Title [{auto_title}]: ").strip() or auto_title
    author = input("  Author []: ").strip() or None
    category = input("  Category []: ").strip() or None
    source = input("  Source []: ").strip() or None
    source_url = input("  Source URL []: ").strip() or None
    return {
        "title": title,
        "author": author,
        "category": category,
        "source": source,
        "source_url": source_url,
    }


def process_one(target: str, args: argparse.Namespace, endpoint: str, secret: str):
    """Process a single PDF file or URL."""
    is_url = target.startswith("http://") or target.startswith("https://")

    if is_url:
        print(f"\nFetching: {target}")
        auto_title, content = extract_web_text(target)
        auto_source_url = target
    else:
        print(f"\nReading: {target}")
        content = extract_pdf_text(target)
        auto_title = guess_title_from_pdf(target)
        auto_source_url = None

    if not content.strip():
        print("  WARNING: No text extracted, skipping.")
        return

    print(f"  Extracted {len(content):,} characters")

    # Use CLI flags if provided, otherwise prompt interactively
    if args.title:
        metadata = {
            "title": args.title,
            "author": args.author,
            "category": args.category,
            "source": args.source,
            "source_url": args.source_url or auto_source_url,
        }
    else:
        metadata = prompt_metadata(auto_title)
        if not metadata.get("source_url") and auto_source_url:
            metadata["source_url"] = auto_source_url

    payload = {**metadata, "content": content}

    print(f"  Ingesting: {metadata['title']}")
    result = send_to_ingest(payload, endpoint, secret)
    print(f"  Done: {result.get('chunks_ingested', '?')} chunks, ~{result.get('total_tokens', '?')} tokens")


def main():
    parser = argparse.ArgumentParser(description="Ingest articles into WodWisdom")
    parser.add_argument("targets", nargs="+", help="PDF files, directories, or URLs")
    parser.add_argument("--title", help="Article title (skips interactive prompt)")
    parser.add_argument("--author", help="Article author")
    parser.add_argument("--category", help="Article category")
    parser.add_argument("--source", help="Article source")
    parser.add_argument("--source-url", dest="source_url", help="Source URL")
    parser.add_argument("--endpoint", default=INGEST_ENDPOINT, help="Ingest endpoint URL")
    parser.add_argument("--secret", default=INGEST_SECRET, help="Ingest secret")
    args = parser.parse_args()

    secret = args.secret
    if not secret:
        print("Error: Set INGEST_SECRET env var or pass --secret")
        sys.exit(1)

    # Expand directories into PDF files
    all_targets = []
    for t in args.targets:
        p = Path(t)
        if p.is_dir():
            all_targets.extend(sorted(str(f) for f in p.glob("*.pdf")))
        else:
            all_targets.append(t)

    if not all_targets:
        print("No files or URLs found.")
        sys.exit(1)

    print(f"Processing {len(all_targets)} item(s)...")

    for target in all_targets:
        try:
            process_one(target, args, args.endpoint, secret)
        except Exception as e:
            print(f"  ERROR: {e}")
            continue

    print("\nAll done!")


if __name__ == "__main__":
    main()
