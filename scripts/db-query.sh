#!/usr/bin/env bash
# db-query.sh — read-only lookup against the project's Supabase REST API
# (PostgREST). Holds no secrets: the public anon key is read from
# src/lib/supabase.ts, and the service-role Authorization header is injected
# by the session's HTTPS proxy (saved as a network secret on the cloud
# environment). GET only — writes are refused here by design.
#
# Usage:
#   scripts/db-query.sh '<table>?<postgrest query>'
#   scripts/db-query.sh 'profiles?select=id,email&email=eq.someone%40example.com'
#   scripts/db-query.sh 'athlete_profiles?select=*&user_id=eq.<uuid>'
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: $0 '<table>?<postgrest query>'" >&2
  exit 2
fi
QUERY="$1"
case "$QUERY" in
  *" "*|*/*) echo "refusing: query must be a single '<table>?<params>' segment" >&2; exit 2 ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_URL="$(grep -o "https://[a-z0-9]*\.supabase\.co" "$ROOT/src/lib/supabase.ts" | head -1)"
ANON_KEY="$(grep -o "eyJ[A-Za-z0-9_.-]*" "$ROOT/src/lib/supabase.ts" | head -1)"
if [ -z "$PROJECT_URL" ] || [ -z "$ANON_KEY" ]; then
  echo "could not read project url / anon key from src/lib/supabase.ts" >&2
  exit 1
fi

curl -sS -m 30 --get "$PROJECT_URL/rest/v1/$QUERY" \
  -H "apikey: $ANON_KEY" \
  -H "Accept: application/json" \
  -H "Prefer: count=exact"
echo
