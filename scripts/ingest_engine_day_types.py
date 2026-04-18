#!/usr/bin/env python3
"""
Ingest Engine day type coaching intents into the RAG chunks table under the
'engine' category. One chunk per day type (content is short, no sub-chunking).

The A/B rocket_races pair is merged into a single "Rocket Races" chunk
because both rows share the same coaching_intent (the A/B distinction is
purely internal rest-duration scheme).

Re-running the script is idempotent: the ingest function upserts chunks by
id, so updates to coaching_intent flow through cleanly.

Required env vars:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY   — for reading engine_day_types
  INGEST_SECRET               — for POSTing to /functions/v1/ingest
  INGEST_ENDPOINT             — optional override (default: prod)
"""

import os
import sys

import requests

SUPABASE_URL = os.getenv("SUPABASE_URL", "https://hsiqzmbfulmfxbvbsdwz.supabase.co")
SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
INGEST_ENDPOINT = os.getenv("INGEST_ENDPOINT", f"{SUPABASE_URL}/functions/v1/ingest")
INGEST_SECRET = os.getenv("INGEST_SECRET")

# IDs that get merged into a single chunk (both share the same coaching intent).
# We keep rocket_races_a and skip _b.
SKIP_IDS = {"rocket_races_b"}

# When a canonical name is needed for the merged rocket chunk.
MERGE_NAME_OVERRIDES = {"rocket_races_a": "Rocket Races"}


def fetch_day_types() -> list[dict]:
    if not SERVICE_KEY:
        print("ERROR: SUPABASE_SERVICE_ROLE_KEY is not set", file=sys.stderr)
        sys.exit(1)
    url = f"{SUPABASE_URL}/rest/v1/engine_day_types"
    params = {"select": "id,name,coaching_intent", "order": "id.asc"}
    headers = {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
    }
    resp = requests.get(url, params=params, headers=headers, timeout=15)
    resp.raise_for_status()
    return resp.json()


def build_content(name: str, coaching_intent: str) -> str:
    return f"Day Type: {name}\n\n{coaching_intent.strip()}"


def ingest_one(title: str, content: str) -> None:
    if not INGEST_SECRET:
        print("ERROR: INGEST_SECRET is not set", file=sys.stderr)
        sys.exit(1)
    resp = requests.post(
        INGEST_ENDPOINT,
        headers={
            "Authorization": f"Bearer {INGEST_SECRET}",
            "Content-Type": "application/json",
        },
        json={
            "title": title,
            "category": "engine",
            "source": "Year of the Engine — Day Types",
            "content": content,
        },
        timeout=30,
    )
    if not resp.ok:
        print(f"FAILED {title}: {resp.status_code} {resp.text}", file=sys.stderr)
        sys.exit(1)
    data = resp.json()
    print(f"  ok   [{title}] chunks={data.get('chunks_ingested')}")


def main() -> int:
    rows = fetch_day_types()
    print(f"Fetched {len(rows)} day types from Supabase")

    ingested = 0
    for row in rows:
        day_id = row["id"]
        if day_id in SKIP_IDS:
            print(f"  skip [{day_id}] (merged into sibling chunk)")
            continue

        coaching_intent = row.get("coaching_intent")
        if not coaching_intent:
            print(f"  skip [{day_id}] (no coaching_intent)")
            continue

        name = MERGE_NAME_OVERRIDES.get(day_id, row["name"])
        title = f"Day Type: {name}"
        content = build_content(name, coaching_intent)
        ingest_one(title, content)
        ingested += 1

    print(f"\nDone. {ingested} engine chunks ingested.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
