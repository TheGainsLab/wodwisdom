#!/usr/bin/env python3
"""Add multi-currency amounts to the retail subscription prices.

Why: 100%% of overseas checkout traffic was seeing USD (verified against the
July '26 checkout.session.expired events — adaptive pricing never applies to
subscription-mode sessions). Pinned currency_options give international
buyers a stable local-currency price, improve cross-border card auth rates,
and unlock local recurring payment methods (SEPA Direct Debit needs a real
EUR price to exist).

Usage (from your machine, with your live secret key):

    export STRIPE_SECRET_KEY=sk_live_...
    python3 scripts/stripe_currency_options.py            # DRY RUN: proposal only
    python3 scripts/stripe_currency_options.py --apply    # write to Stripe

Behavior:
- Lists active recurring prices, proposes an amount per currency in TARGETS
  for any currency the price doesn't already have (existing options are
  never touched).
- Proposal = USD amount x rate, rounded to the nearest N.99 (merchandising
  numbers, not FX-desk numbers). Edit RATES/TARGETS to taste before --apply;
  rates drift, and the point of pinned prices is choosing them deliberately.
- Renewals bill in whatever currency the subscription started in; changing
  currency_options later never touches existing subscriptions.

After applying: enable SEPA Direct Debit in the Stripe dashboard (it becomes
eligible once EUR checkouts exist). No wodwisdom code changes are needed —
create-checkout passes price IDs and Checkout picks the buyer's currency;
entitlements key on price metadata, not amounts.
"""

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request

# USD -> target currency rates (approximate mid-2026; edit before --apply).
RATES = {
    "eur": 0.93,
    "gbp": 0.79,
    "cad": 1.36,
    "aud": 1.51,
    "sgd": 1.34,
}
TARGETS = list(RATES.keys())

API = "https://api.stripe.com/v1"


def stripe_call(key: str, method: str, path: str, params=None):
    data = urllib.parse.urlencode(params or {}).encode() if params else None
    req = urllib.request.Request(
        f"{API}{path}", data=data, method=method,
        headers={"Authorization": f"Bearer {key}"},
    )
    with urllib.request.urlopen(req) as resp:
        return json.load(resp)


def propose_cents(usd_cents: int, rate: float) -> int:
    """USD cents x rate, snapped to the nearest N.99."""
    converted = usd_cents * rate
    whole = max(1, round(converted / 100))
    return whole * 100 - 1


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write to Stripe (default: dry run)")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_SECRET_KEY")
    if not key:
        sys.exit("Set STRIPE_SECRET_KEY first (export STRIPE_SECRET_KEY=sk_live_...)")

    prices = stripe_call(key, "GET", "/prices?active=true&type=recurring&limit=100")["data"]
    if not prices:
        sys.exit("No active recurring prices found.")

    for p in prices:
        if p["currency"] != "usd":
            continue
        # product may be an id string; fetch the name for readable output
        prod = p["product"]
        prod_name = prod if isinstance(prod, str) else prod.get("name", "?")
        if isinstance(prod, str):
            try:
                prod_name = stripe_call(key, "GET", f"/products/{prod}").get("name", prod)
            except Exception:
                pass
        usd = p["unit_amount"]
        interval = p["recurring"]["interval"]
        count = p["recurring"].get("interval_count", 1)
        existing = set((p.get("currency_options") or {}).keys()) - {"usd"}
        missing = [c for c in TARGETS if c not in existing]

        print(f"\n{p['id']}  {prod_name}  ${usd/100:.2f} USD / {count} {interval}")
        if existing:
            print(f"  already has: {', '.join(sorted(existing))}")
        if not missing:
            print("  nothing to add")
            continue

        params = {}
        for cur in missing:
            cents = propose_cents(usd, RATES[cur])
            print(f"  + {cur.upper()}: {cents/100:.2f}")
            params[f"currency_options[{cur}][unit_amount]"] = str(cents)
        # Keep existing options intact: Stripe replaces the whole map on
        # update, so re-send what's already there.
        for cur in existing:
            opt = p["currency_options"][cur]
            params[f"currency_options[{cur}][unit_amount]"] = str(opt["unit_amount"])

        if args.apply:
            stripe_call(key, "POST", f"/prices/{p['id']}", params)
            print("  APPLIED")

    if not args.apply:
        print("\nDry run — re-run with --apply to write these to Stripe.")


if __name__ == "__main__":
    main()
