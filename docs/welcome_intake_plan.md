# Welcome intake — plan (decided 2026-11-11)

Status: AGREED, NOT BUILT. Mockup: `docs/welcome_intake_mockup.html`
(open in a browser at phone width; app theme, pricing copy from
`PricingPlans.tsx`).

## Why

The welcome gate (`/welcome`, Oct 2026) fires on every account's first load.
It is written for the free signup — profile → free evaluation → Coach — and
it works: of 51 accounts since it shipped, 46 tapped through, 42 built a
profile, 31 finished the evaluation. Two problems:

1. It has one exit. Everyone is sent to the lifts profile, including a buyer
   who just paid for the Engine (the signed-out purchase path creates the
   account AFTER paying, so even a buyer lands here).
2. It sells nothing. The goal is to get people to buy programs; the page
   never shows a plan.

## The screen (free account — the only one that sees it)

Plans first, free doors under. Every row is a button. No "Got it" taps;
tapping any row marks the welcome as seen (`profiles.welcome_seen_at`).

**Welcome — pick your path**

GET A PROGRAM (names, prices, blurbs from `PricingPlans.tsx`, same order)
- AI Programming — $29.99/mo → Stripe checkout (plan `programming`)
- All Access — $49.99/mo, Best value → checkout (plan `all_access`)
- Year of the Engine — $29.99/mo → checkout (plan `engine`)

OR START FREE
- Free AI evaluation → `/profile` (lifts, skills, times; evaluation generates there)
- AI Coach → `/chat` (three questions free; the Coach's own banner and
  nudges steer to the profile from inside)
- Research Library → `/knowledge` (open to read; never reads the profile)

Footer: "Programs and All Access are built from your evaluation — buy now,
build your profile next."

## What is behind it (routing by entitlement)

Decided 2026-11-11:

- A plan button goes to the payment page for THAT plan (Stripe checkout,
  plan `programming` / `all_access` / `engine`). Nothing in between.
- After payment, Programming AND All Access go to `/profile`: the evaluation
  is required to generate a program, and the goal is part of Programming.
  For All Access the goal carries over to the Engine (one shared goal) —
  tell them so on the profile/goal step: "Your goal also sets up your
  Engine." Engine setup follows from the home tile / Engine page.
- After payment, Engine alone goes to the Engine setup (days/week + goal +
  assessment-month briefing).
- Paid account, first load (the signed-out buyer creates the account AFTER
  paying, so the gate must route by entitlement): Programming or All Access
  with no evaluation → `/profile`; Engine with no program → Engine setup;
  Coach / Research only → the screen, free rows marked "included in your
  plan". Reaching any of those marks the welcome seen.

## Facts that shaped it

- Engine never reads the lifts profile; its setup takes days/week + goal,
  and day-one time trial calibrates.
- The library is identical with or without a profile (pure research,
  founder ruling 2026-10-21).
- The evaluation is required for AI Programming and All Access.

## Related, separate work (not agreed yet)

- Evidence-led exit on the evaluation: lead with Engine / All Access when
  the evaluation's top priority is aerobic or anaerobic capacity, Programming
  otherwise. Touches the evaluation prompt, output and the upgrade card.
