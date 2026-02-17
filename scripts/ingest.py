#!/usr/bin/env python3
"""
Ingest articles (PDFs or web URLs) into WodWisdom.

Usage:
  python scripts/ingest.py article.pdf
  python scripts/ingest.py https://journal.crossfit.com/article/some-article
  python scripts/ingest.py https://pmc.ncbi.nlm.nih.gov/.../article.pdf   # PDF URL
  python scripts/ingest.py ./pdfs/            # whole folder of PDFs

Optional flags:
  --title "..."       Override auto-detected title
  --author "..."      Article author
  --category "..."    e.g. journal, science
  --source "..."      e.g. CrossFit Journal
  --source-url "..."  Link to original article
  --batch             Non-interactive: auto-detect title from filename
  --endpoint URL      Override ingest endpoint
  --secret SECRET     Override INGEST_SECRET (or set env var)

Batch example (84 Guyton chapters):
  python scripts/ingest.py ./guyton-chapters/ --batch \
    --category science \
    --source "Textbook of Medical Physiology" \
    --author "Guyton & Hall"
"""

import argparse
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from pypdf import PdfReader

# Minimum chars of body text before we consider JS-rendering fallback
_MIN_CONTENT_LENGTH = 200


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
    """Fetch a URL and return (title, body text).

    Falls back to headless browser rendering (Playwright) when the static
    HTML yields very little text, which indicates a JS-rendered SPA.
    """
    resp = requests.get(url, timeout=30, headers={"User-Agent": "WodWisdom-Ingest/1.0"})
    resp.raise_for_status()
    title, text = _parse_html_response(resp)

    if len(text.strip()) >= _MIN_CONTENT_LENGTH:
        return title, text

    # Static HTML had almost no content — likely a JS-rendered page.
    print("  Static HTML yielded very little text, trying headless browser...")
    return _render_js_page(url)


def is_pdf_url(url: str) -> bool:
    """Check if a URL points to a PDF (by extension or Content-Type)."""
    path = urlparse(url).path.lower()
    if path.endswith(".pdf"):
        return True
    # HEAD request to check Content-Type without downloading the whole file
    try:
        resp = requests.head(url, timeout=10, headers={"User-Agent": "WodWisdom-Ingest/1.0"}, allow_redirects=True)
        content_type = resp.headers.get("Content-Type", "")
        return "application/pdf" in content_type
    except requests.RequestException:
        return False


def _parse_html_response(resp: requests.Response) -> tuple[str, str]:
    """Parse an HTML response and return (title, body text)."""
    soup = BeautifulSoup(resp.text, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()
    title = soup.title.string.strip() if soup.title and soup.title.string else ""
    article = soup.find("article") or soup.find("main") or soup.find("body")
    text = article.get_text(separator="\n", strip=True) if article else soup.get_text(separator="\n", strip=True)
    return title, text


def _render_js_page(url: str) -> tuple[str, str]:
    """Render a JS-heavy page with Playwright and extract text."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        sys.exit(
            "  ERROR: This page requires JavaScript rendering but Playwright is not installed.\n"
            "  Install it with:\n"
            "    pip3 install playwright && python3 -m playwright install chromium\n"
        )

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(url, wait_until="networkidle", timeout=30_000)
        html = page.content()
        browser.close()

    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()
    title = soup.title.string.strip() if soup.title and soup.title.string else ""
    article = soup.find("article") or soup.find("main") or soup.find("body")
    text = article.get_text(separator="\n", strip=True) if article else soup.get_text(separator="\n", strip=True)
    return title, text


def download_pdf(url: str) -> tuple[str, str]:
    """Download a PDF from a URL, extract text, and return (title, text).
    Falls back to HTML parsing if the server returns a web page instead."""
    resp = requests.get(url, timeout=60, headers={"User-Agent": "WodWisdom-Ingest/1.0"})
    resp.raise_for_status()

    content_type = resp.headers.get("Content-Type", "")
    is_pdf = "application/pdf" in content_type or resp.content[:5] == b"%PDF-"

    if not is_pdf:
        print("  Server returned HTML instead of PDF, parsing as web page...")
        return _parse_html_response(resp)

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(resp.content)
        tmp_path = tmp.name

    try:
        text = extract_pdf_text(tmp_path)
    finally:
        os.unlink(tmp_path)

    # Derive a title from the URL filename
    filename = Path(urlparse(url).path).stem
    title = filename.replace("-", " ").replace("_", " ").title() if filename else ""

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


def normalize_url(url: str) -> str:
    """Rewrite known PDF-viewer URLs to their HTML article equivalents.

    PMC PDF URLs (e.g. .../articles/PMC123456/pdf/filename.pdf) serve a
    JS-based viewer with no extractable text.  The full-text HTML lives at
    the parent article path (.../articles/PMC123456/).
    """
    # PMC: https://pmc.ncbi.nlm.nih.gov/articles/PMC.../pdf/....pdf
    m = re.match(r"(https?://pmc\.ncbi\.nlm\.nih\.gov/articles/PMC\d+)/pdf/.+\.pdf", url)
    if m:
        rewritten = m.group(1) + "/"
        print(f"  Rewriting PMC PDF URL → {rewritten}")
        return rewritten
    return url


def process_one(target: str, args: argparse.Namespace, endpoint: str, secret: str):
    """Process a single PDF file or URL."""
    is_url = target.startswith("http://") or target.startswith("https://")
    is_txt = not is_url and target.lower().endswith(".txt")

    # Rewrite known PDF-viewer URLs to full-text HTML equivalents
    if is_url:
        target = normalize_url(target)

    if is_url and is_pdf_url(target):
        print(f"\nDownloading PDF: {target}")
        auto_title, content = download_pdf(target)
        auto_source_url = target
    elif is_url:
        print(f"\nFetching: {target}")
        auto_title, content = extract_web_text(target)
        auto_source_url = target
    elif is_txt:
        print(f"\nReading: {target}")
        with open(target, "r") as f:
            content = f.read()
        auto_title = guess_title_from_pdf(target)
        auto_source_url = None
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
    elif args.batch:
        metadata = {
            "title": auto_title,
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
    parser.add_argument("--batch", action="store_true",
                        help="Non-interactive batch mode: auto-detect title from filename, "
                             "use CLI flags for the rest")
    parser.add_argument("--endpoint", default=INGEST_ENDPOINT, help="Ingest endpoint URL")
    parser.add_argument("--secret", default=INGEST_SECRET, help="Ingest secret")
    args = parser.parse_args()

    secret = args.secret
    if not secret:
        print("Error: Set INGEST_SECRET env var or pass --secret")
        sys.exit(1)

    # Expand directories into PDF files (recursively)
    all_targets = []
    for t in args.targets:
        p = Path(t)
        if p.is_dir():
            all_targets.extend(sorted(str(f) for f in p.rglob("*.pdf")))
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
