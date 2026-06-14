# Deck — Technology & Defensibility Slides

> Drop-in content for your pitch deck. Each slide has a **headline**, **on-slide
> bullets** (keep them tight), and **speaker notes** (what you say out loud).
> **[FILL IN]** marks where your traction/customer numbers go.

---

## SLIDE — "Not a wrapper. An audited AI engine."

**Headline:** We solved the trust problem in AI coaching.

**On-slide bullets:**
- Most AI fitness apps are one prompt to an LLM — and LLMs confidently get
  training wrong.
- Our generator is a **multi-stage pipeline** with **deterministic audits**:
  every program is verified against hard rules — including the athlete's real
  strength numbers — before they see it.
- A bad prescription (e.g. loading above an athlete's max) is **caught by code,
  not by luck.**

**Speaker notes:**
> Anyone can call an LLM. The hard part is making the output safe and coherent
> enough that a real athlete trusts it with their training. We built a pipeline
> that drafts, then audits against seven deterministic rules plus a safety
> review, then surgically fixes the specific failures and re-checks. That
> verification layer is the moat — it's months of domain engineering, not a
> prompt a competitor copies over a weekend.

---

## SLIDE — "A structured domain model competitors don't have"

**Headline:** The AI is grounded in our data, not generic knowledge.

**On-slide bullets:**
- Proprietary **movements library** (modality, category, work-rates, aliases),
  time-domain logic, and per-athlete benchmarks.
- A curated **methodology knowledge base**, vectorized for retrieval — coaching
  answers are **grounded and attributed**, not hallucinated.
- This structured layer is **what makes the audits possible** — and it compounds.

**Speaker notes:**
> We don't ask the model to "know fitness." We encoded the domain. That
> structured layer is what lets us check the AI's work and personalize it — and
> it's slow and expensive for a generic competitor to reproduce.

---

## SLIDE — "Five products, one platform"

**Headline:** Multiple revenue lines on shared infrastructure.

**On-slide bullets:**
- AI Coach · AI Programming · Year of the Engine · AI Nutrition · Competition
  History.
- One backend, one **entitlements system decoupled from billing** → bundle,
  trial, cross-sell, and expand without re-architecting.
- Multiple price points and **natural expansion revenue** per account.

**Speaker notes:**
> Each product is independently gated and sellable, but they share infra and a
> single athlete profile. That means low marginal cost to add a product and a
> clear path to expansion revenue — land with one product, grow into the rest.

---

## SLIDE — "The data flywheel"

**Headline:** Every workout makes the coaching better.

**On-slide bullets:**
- Athlete logs → analytics → profile re-evaluation → **adaptive targets**
  (Year of the Engine recalibrates pace to recent performance).
- Better personalization → retention → more data → better output.
- Human-in-the-loop **quality rating system** layered on automated audits.

**Speaker notes:**
> The product gets smarter with use. Logged training feeds analytics that feed
> personalization that drives retention — and our admin grading tools let us
> systematically improve AI quality. The longer an athlete stays, the better
> and stickier it gets.

---

## SLIDE — "Built to scale, capital-efficiently"

**Headline:** Serverless, mobile-first, margin-aware.

**On-slide bullets:**
- **Serverless edge + managed Postgres** — scales with usage, near-zero fixed
  cost.
- **Installable PWA** — reaches phones with **no app-store fees or
  gatekeeping**; instant updates.
- Unit-economics discipline built in: **model tiering** (Sonnet for high-stakes,
  Haiku fallback), caching, budget-aware prompts.

**Speaker notes:**
> We're not burning money on idle servers or paying a 30% app-store tax. AI cost
> per user is actively managed through model tiering and caching, so gross
> margin improves as cheaper models absorb more of the workload.

---

## SLIDE — "Execution velocity & trust" (proof points)

**Headline:** A small team shipping a serious system.

**On-slide bullets (by-the-numbers):**
- ~68,000 lines of code · 68 backend functions · 54 tables · **150 schema
  migrations**.
- **131 row-level-security policies** — per-user data isolation at the database
  layer.
- CAPTCHA + spam defense + server-side-only entitlements **already shipped**.
- **[FILL IN]** customers · **[FILL IN]** MRR · **[FILL IN]** retention.

**Speaker notes:**
> 150 migrations from a small team is a velocity signal — we ship continuously
> and evolve the core safely. And the security work is already done: data
> isolation, anti-abuse, and server-side billing controls are in place, not on a
> someday roadmap.

---

## Appendix — One-liners for Q&A

- **"Isn't this just ChatGPT for workouts?"** → No. The value is the audit and
  verification layer plus our structured domain model. The LLM is one component
  in a pipeline that checks its work against the athlete's real numbers.
- **"What about AI cost / margins?"** → Model tiering (Haiku fallback), caching,
  and budget-aware prompts. Margin improves as cheaper models take more load.
- **"What's defensible?"** → The audited-generation pipeline + the structured
  movements/methodology data + the flywheel. Each compounds; none is a prompt.
- **"Provider risk?"** → Model calls are abstracted with fallback today;
  multi-provider is a tractable next step.
