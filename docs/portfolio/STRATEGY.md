# TheGainsLab — Portfolio Strategy

> The strategic narrative for the three-repo portfolio (`wodwisdom`,
> `crossfit-competition-service`, `affiliate-intelligence`). Companion to
> `INVENTORY_AND_MAP.md` (what exists), `ENGINE_EXTRACTION.md` (how the core
> gets separated), and `FLIP_THE_GATE_AUDIT.md` (Competition History launch).
> Status: draft for founder review, 2026-07.

---

## 1. Thesis

**The gym is hardware. The programs are software. We are the intelligence
layer — and it does not exist anywhere else in the industry.**

A gym is dumbbells, barbells, and rowing machines; it runs whatever software
you load onto it — CrossFit, Hyrox, soccer prep, a kids program. Every
incumbent in fitness technology sells tools for managing the hardware layer
(scheduling, billing, class bookings). Nobody owns the layer where the value
actually lives: **what each athlete should do today, and why** — programming,
personalization, intake, benchmarking, adaptation.

We own that layer. It is already built, live, and revenue-generating in one
channel (B2C), and the strategy below extends it to two more.

---

## 2. What we have (summary)

See `INVENTORY_AND_MAP.md` for the full map. In brief:

| Asset | Where it lives | State |
|---|---|---|
| **The Engine** — multi-stage AI generation with deterministic audits (draft → audit → surgical fix → re-check), grounded RAG coaching, adaptive conditioning | inside `wodwisdom` | Live, B2C revenue; not yet extracted as a service |
| **The Data layer** — competition results (~3.8M rows), movement biomechanics, the proprietary joules/watts/W·kg physics model, percentile curves | `crossfit-competition-service` | Live; already a real versioned, keyed, rate-limited internal API with two consumers |
| **The Gym surface** | `affiliate-intelligence` | Sketch (v0, not productized) — to be rebuilt as the gym channel storefront |
| **The B2C surface** — installable PWA, 5 gated products, decoupled entitlements | `wodwisdom` | Live in production |

Two structural facts from the code audit that shape everything:

1. **The internal-API discipline already exists.** The data service has
   versioned endpoints, hashed consumer keys, and per-consumer rate limits,
   with `wodwisdom` and `affiliate-intelligence` as consumers. We are not
   inventing the "products consume products" pattern — we are extending the
   one that works to the Engine.
2. **The Engine is accidentally well-factored.** Its DB coupling and its
   CrossFit coupling are separate (see `ENGINE_EXTRACTION.md`): the pipeline
   is a stateless control plane (payload in, audited artifact out); the sport
   lives in swappable content (prompts, archetypes, audit rules, movement
   vocabulary). Extraction is seam-cutting, not a rewrite.

---

## 3. The model: three shared services, three channels

### Shared services (the core)

1. **Engine** — generation / audit / RAG. Two native modes from one flag:
   - **Adaptive mode** (retail): embedded AI recalibrates each athlete
     continuously.
   - **Cohort mode** (gym/team): everyone on the same path with individualized
     scaling — leaderboard-ready, shared class experience. The same flag is
     the future bridge to team sports.
   Contract requirements already specified: `athletes[]` always an array
   (1 retail, N gym roster), `tenant_id` + `corpus_scope` on every request
   (white-label/multi-corpus is ~free now, a brutal retrofit later),
   `model_profile` indirection, versioned `domain_pack`.
2. **Data** — competition analytics + the physics model. The joules/watts
   measurement layer is wholly proprietary and works with zero external data;
   scraped competition data is *one enrichment source*, not a dependency.
3. **Intake / Profile** — conversational intake (voice/text ramble →
   structured JSON athlete object) as the front door to a portable athlete
   profile. Two flavors of one mechanism:
   - **Athlete intake**: goals, preferences, constraints, maxes, skills.
   - **Methodology intake**: a gym or brand's programming history + guided
     "what do you believe about training" conversation → a tenant methodology
     corpus. Serves gyms with a voice (upload), gyms that lost it to
     outsourcing (guided), and future white-label onboarding.

### Domain packs (content, not code)

A sport = archetype specs + movement vocabulary + audit-rule tuning + a
curated methodology corpus. CrossFit is built (currently split between two
repos — consolidating it is part of the extraction). Each new sport is a
content project on a proven engine, not a rebuild. **Sport #2 is Hyrox**:
closest adjacency (same movement universe, same gyms, same athletes), fast
growth, and it proves the "new sport = content" claim before we promise
team sports. Football/soccer/baseball follow once the pack format is proven —
they arrive with a different buyer (coaches/programs) and cohort mode already
built.

### Channels (distribution)

1. **B2C — wodwisdom.** Live revenue. Permanent role: proving ground,
   reference implementation, and R&D lab. We do not migrate away from retail;
   we run both altitudes deliberately.
2. **B2B (gyms) — affiliate-intelligence, rebuilt as the gym storefront.**
   The single relationship through which the entire portfolio sells to gyms
   (auth, tenancy, billing, revenue splits live here; everything else is a
   service it consumes). See §5.
3. **B2B2C (coaches / platforms) — the Engine API.** Highest leverage,
   sequenced last, and the largest slice of the "where capital accelerates"
   story. First customer is internal (the gym channel), then 2–3 design
   partners, then productization.

---

## 4. Corporate structure: one company, layered internally

**Decision: one company, one cap table.** The "product A is a customer of
product B" idea is an *architecture* discipline (clean versioned service APIs
between layers), not a corporate structure. Databases stay separate and
connect through APIs; no big-bang merge.

Why not alternatives:
- *One merged blob*: buries the B2B and data value inside consumer metrics;
  investors index on the weakest number.
- *Holdco / separate entities*: premature — transfer pricing, split metrics,
  diluted focus. The clean API seams **preserve the option** to spin out or
  sell a layer later without paying for that option now.

The raise narrative this enables: **a vertically integrated AI fitness
infrastructure company — multiple revenue lines, one flywheel** — rather than
"a workout app" or "three separate startups."

---

## 5. The gym channel: revenue per square foot

The pitch to a gym owner is economic, not technological — and it names the
trap the industry keeps selling them into. Every standard answer to a
struggling gym (raise prices, run more personal-training sessions, add
nutrition coaching, do semi-private training) **scales linearly with the
owner's hours — the ceiling is their calendar.** Our tools are the opposite
shape: **revenue and retention that grow without consuming the owner's time,
and (via remote members) without adding a square foot.**

**The deeper wound (the pitch's emotional core):** an affiliate's entire
premium over a globo gym is *"somebody here knows you."* Outsourced
programming (HWPO/Mayhem/CompTrain subscriptions) quietly hollowed that out —
the owner has warm conversations about members' lives but **zero transparency
into the thing members actually pay for**: how their fitness is going. It's
nobody's fault; the owner has no instrumentation. Leaderboards are snapshots —
"good job on toes-to-bar, Steve" feels good for a day and retains no one.
We destroy that paradigm in three moves: **control back** (tell the AI how you
want your gym to run; it rebuilds your programming in your voice),
**individualization** (every member gets their version), and **transparency**
(the individualizations and the feedback loop are surfaced TO THE OWNER —
per-member trajectories, stalls, quiet-member signals, coaching moments).
The AI doesn't replace the coach relationship; it **re-arms it** — the echo of
the ClassPass line in §6: personalization that scales the relationship itself.

The product ladder (each rung an upsell on the same engine; full service
definitions in `GYM_SKU_SPEC.md`; pricing decided — see D8/D9):

There are **two front doors**, then the ladder:

1a. **Engine Class** (standalone, $6/active seat/mo, $0 setup, 10-seat minimum
   from launch) — **pure distribution of the retail Engine program (Decision
   9(i), 2026-07)**: the gym owner is a distributor; a seat unlocks the proven
   retail Engine for the member (their own program, own pace, day 1), behind a
   gym shell with no cross-sell (Decision 10). Zero marginal content cost —
   reselling the Year of the Engine is easy revenue on equipment the gym
   already owns. A *new resellable service*, sellable to any gym with zero
   dependencies — the higher-converting wedge. (Group surfaces — leaderboards,
   TV — are parked as AI-Programmer assets, where classes genuinely share
   workouts.)
1b. **Analytics wedge** ($49/mo flat) — the dashboard, for data-curious owners.
2. **AI gym programmer** ($149/mo base + $3/member/mo roster-wide, includes
   analytics) — "design next month's programming: your goals, your focus,
   your style." Onboarding: *upload your last three months of programming and
   the AI learns how you run your gym* (consented, first-party — the AI
   Replicate mechanism pointed at the customer's own data). To the owner it
   is two buttons: *generate* and *personalize*. **All-or-nothing: every
   member gets the personalized version** (one system on the class floor;
   shared workout, individual loads). This is a *switch sale* — it displaces
   the gym's programming subscription and publishing habit — de-risked by
   shadow-mode trials. Distribution is owned-surfaces-only (member PWA, TV
   mode, portal): the block format is the learning loop and does not export.
3. **Member AI Seat** ($6/active member/mo; $5 at 100+, $4 at 200+) — the
   opt-in seat for opt-in products (Engine Class participants); enriched
   intake rides with it. Whole-gym products bill the roster instead.
4. **Remote memberships** ($30/mo wholesale; gym retails at ≥ the retail
   price floor) — revenue with zero floor space; the denominator disappears.

**Channel mechanics: per-seat wholesale, not revenue share.** The gym buys
seats at wholesale and prices its members freely (we provide suggested-retail
guidance and margin math, never enforcement — except the remote-membership
retail floor, which protects our own retail product). Billing follows *active*
seats, never roster size — flat entry regardless of gym size is the answer to
"there is no target gym": who activates seats tells us the market.

**Displacement target:** not gym-management software — the **affiliate
programming subscription** (Mayhem/HWPO/CompTrain-style, ~$100–300/mo, or
uncounted owner hours). We capture an existing budget line and add the thing
no template subscription can offer: per-member personalization.

**Quality stays with us.** Gym owners are never made QA engineers for AI
output. The deterministic audit layer plus our human-in-the-loop grading is
the QA function; the partner-facing surface is intent-steering only
("approve / regenerate with a note").

### Affiliate Intelligence: the intelligence layer for gym owners (founder, 2026-07-05)

The name is intentional. Affiliate Intelligence is a **separate site with a
separate front end whose consumer is the gym owner**, and its purpose is
singular: **make gyms more successful.** Gym owners are underserved by
technology — the products available to them aren't good, and the AI they do
use (marketing copy) is table stakes: when everyone prompts the same models
with the same minds, nothing differential comes out. What owners actually
care about is **acquiring people, retaining people, revenue per square foot,
revenue per hour** — and that is what the tool set serves.

Two sales framings, both true, use whichever lands: **"a service provider
that upgrades your gym"** and **"an intelligence layer for your gym."**

Two structurally novel things in the industry:
1. **Reselling services.** No one lets a gym resell a proven consumer product
   at wholesale. Engine Class is the proof: easy revenue on equipment they
   already own.
2. **The unbundled tool catalog.** Everything built for the retail user can be
   sold to gym owners individually or collectively — implemented with their
   people. Each is a priced value unit (the tool inventory, Decision 10(e),
   is this catalog's source of truth):
   - the historical dashboards — *worth something just to see how their gym
     is doing*;
   - a member's competition history — worth something;
   - the gym's competition history — worth something;
   - the AI coach chat — worth something at the individual level AND at the
     gym level;
   - performance measured in watts per kilogram — worth something;
   - the AI Programmer — worth something, tweaked to serve owners: it lets an
     owner **write their own programming with their own intention**, instead
     of buying a template from a service that knows nothing about them.

Open thread (founder): some of these tools may also be useful sold to
individuals — to be thought through, not assumed.

This subsection is the commercial frame for Decisions 9 and 10: the member
gets the product *through* the gym (never marketed past the owner), and the
AI suite's job is to make the owner more intelligent — which is what makes
the relationship both higher-revenue and more agreeable.

### Remote membership is the retail↔wholesale bridge

A remote membership is essentially the retail product wrapped in a gym
relationship with a revenue split. This inverts channel conflict: gyms become
*distribution* for the retail product, attaching what only they have (a local
human relationship) to what only we have (the Engine). Design rules that keep
the two altitudes healthy:

- **The athlete profile is portable across channels** (lives in the shared
  core, not in any channel's tenancy). A member whose gym lapses converts to
  retail without losing history; a retail user who joins a participating gym
  links their account.
- **Wholesale pricing has a floor**, and the gym bundle includes things retail
  doesn't get (class experience, leaderboards, coach oversight) — so "buy
  through your gym" is differentiated, not just discounted.
- Wholesale is a **grant path on the existing entitlements layer** (gym buys N
  seats → portal assigns entitlements), not a parallel billing system.

---

## 6. Moats

1. **The audited-generation pipeline.** Draft → deterministic audit (load
   sanity vs. real 1RMs, vocabulary compliance, structural rules) → surgical
   fix → re-check. This is what makes machine-written training safe to put a
   brand on — ours, a gym's, or a partner's. Months of domain engineering,
   not a copyable prompt.
2. **The incumbents can't cross over.** Gym-software platforms
   (Wodify/PushPress-class, and Mindbody/ClassPass beyond CrossFit) would need
   a teardown to build this. They can buy or partner their way in eventually —
   which makes them plausible acquirers/partners, and makes speed the
   priority.
3. **The programming brands are narratively forbidden from responding.** A
   famous-athlete programming brand's entire value proposition is "a champion
   thinks about your training." Announcing AI disconnects the human from the
   loop and destroys their own premise — a structural innovator's dilemma. We
   can take the affiliate-programming market from below without retaliation.
   Consequence: **the real competitive threat is another engine vendor arming
   gyms first**, and none is visible today.
4. **The physics model.** Output in joules, watts, W/kg — proprietary,
   self-sufficient, independent of any external data source.
5. **A first-party data flywheel with clean provenance.** The gym channel is a
   data-acquisition machine: gyms and members contribute performance data with
   consent baked into terms. Over time this replaces scraped competition data
   with richer, consented, proprietary *training* data nobody can revoke or
   scrape.
6. **Positioning.** ClassPass scaled access by degrading the coach–member
   relationship ("makes good gyms bad and bad gyms bigger"). AI
   personalization scales the relationship itself. That is the one-sentence
   answer to "how is this different from every fitness-tech rollup."

---

## 7. Data posture

- Competition data was scraped; rights are unclear; athletes and gyms likely
  own their own data. Posture: **derived analytics, consumed by our own
  products only.**
- **No external Competition Data API** as a product. Weak market outside
  training + unclear rights = not worth the exposure. Not in the deck.
- Competition History is **free for all authenticated users — decided and
  shipped** (`ATHLETEDATA_PUBLIC_TIER = true` on both client and server;
  logging/placement free via `hasCompetitionLogAccess`). Free is deliberately
  the strongest rights posture: no money ever changes hands for the data — no
  whiff of selling someone else's results. Its value is retention, verified
  identity feeding programming (Tier-4 already consumes it as optional intake
  enrichment), and shareable "how do I stack up" moments. Remaining work is
  operational, not decisional: cache the near-static catalog (H2) and address
  the shared-service-key rate-limit bucket (H1) — more urgent, not less,
  because free-to-all means maximum traffic on one shared key.
- The scraper is treated as a **fragile supply line**, not a foundation:
  everything degrades gracefully without it, and the physics model + the
  first-party flywheel are the long-term substrate.

---

## 8. What we will NOT do (guardrails)

- **No gym-management software.** Scheduling, billing, bookings, front-desk —
  a swamp that resists elegance (Mindbody + ClassPass: billions spent, still
  stuck). We are the intelligence layer on top. Integrations with incumbents
  stay **shallow** (roster sync, schedule reads) — never build deep on the
  APIs of companies we may outlive. If replacement ever happens, it happens by
  gravity (expansion from strength), not assault — and "replace Mindbody" is
  never the headline.
- **No AI Replicate as a standalone consumer product.** "Upload HWPO's
  programming, clone it" makes every coach an enemy and walks into IP murk.
  The mechanism survives in consented forms only: gym onboarding (own data)
  and, if white-label happens, "bring your program to life" with the brand as
  a paid participant.
- **No standalone competition-data SKU or external data API** (§7).
- **No separate legal entities** until a layer earns independence (§4).
- **No fourth surface.** The planned competition dashboard is a *feature*
  (coach view in the gym portal, athlete tier in wodwisdom), not a repo.
- **Premature platformization.** External API consumers are an SLA and support
  commitment. Order is fixed: internal consumers → 2–3 design partners →
  public/self-serve.

---

## 9. Sequencing

**Phase 0 — hygiene (done or in flight).**
Inventory + extraction plan docs; affiliate → versioned data-service API
(one contract, N consumers); freeze wodwisdom's relic gym tables
(affiliate-intelligence owns "gym as a customer"); Competition History
safe-launch path per the flip-the-gate audit.

**Phase 1 — cut the Engine seam.**
Per `ENGINE_EXTRACTION.md`, cheapest-first: corpus `tenant_id` +
`model_profile` (cheap now, brutal later), then the Engine API contract
(`athletes[]`, `domain_pack`, cohort/adaptive flag), then the CrossFit Domain
Pack consolidated out of both repos. Generalize tier-3 intake into the
Intake/Profile service.

**Phase 2 — the gym channel.**
Rebuild affiliate-intelligence as the storefront on the ladder in §5, with the
Engine API as its supplier — the Engine's first external-style customer proves
the contract. Wholesale grant path on the entitlements layer. First-party data
consent baked into gym terms from day one.

**Phase 3 — proof of generality.**
Hyrox domain pack shipped through both existing channels. This converts
"new sport = content project" from claim to demonstrated fact — the key
evidence for everything in §10.

**Phase 4 — leverage.**
Engine API design partners (coach marketplaces, platforms, willing brands);
white-label where a brand can thread the "champion methodology,
AI-individualized" needle; team-sport packs on cohort mode.

Each phase funds and de-risks the next; none requires abandoning a live
revenue line.

---

## 10. The raise, in one arc

1. **Proof:** a live, revenue-generating B2C product built on an audited AI
   engine nobody else has (traction numbers here).
2. **Wedge:** the gym channel — an existing budget line (affiliate
   programming) captured with a 10x product, opening rev-per-sq-ft expansion
   and the consented data flywheel.
3. **Leverage:** the Engine as infrastructure — every gym, coach, and platform
   with an audience becomes a customer instead of a competitor, while the
   incumbents who could pay to enter are structurally unable to build it.
4. **Where capital goes:** cutting the Engine seam faster, the gym-channel
   build, the Hyrox proof, and the first design partners — i.e., converting
   an existing asset into infrastructure, not searching for product-market
   fit.

---

## 11. Decision log

| # | Decision | Status |
|---|---|---|
| D1 | One company, layered internally; APIs not entities | **Decided** |
| D2 | affiliate-intelligence owns "gym as a customer"; wodwisdom gym tables frozen | **Decided** (migration written) |
| D3 | No external competition-data product; derived analytics internal-only | **Decided** |
| D4 | AI Replicate → consented onboarding mechanism only | **Decided** |
| D5 | Competition History = free for all authenticated users | **Decided & shipped** — founder decision predates this doc; remaining work is H2 (catalog caching) + H1 (per-key rate limits) + dead-code cleanup (`hasAthleteDataAccess`) |
| D6 | Sport #2 = Hyrox | **Recommended** |
| D7 | Direct-to-gym AI programmer prioritized over brand white-label | **Decided** (innovator's-dilemma logic, §6.3) |
| D8 | Gym-channel pricing: Engine Class standalone $6/active seat ($0 setup, 10-seat min from launch); Analytics $49/mo; AI Gym Programmer $149/mo incl. analytics; Member AI Seat $6/$5/$4 by volume; per-seat wholesale (no rev-share), active-seat billing, founding-partner pilots ~50% off 6 mo for data consent + case study | **Decided 2026-07** — service definitions in `GYM_SKU_SPEC.md` |
| D9 | Remote membership: $30/mo wholesale, gym retails at ≥ retail floor ($50/mo, $120/qtr); differentiation additive (coach relationship, gym leaderboard, community); profile portable both directions | **Decided 2026-07** |
| D10 | Engine API commercial terms for design partners | **Open** (Phase 4) |
