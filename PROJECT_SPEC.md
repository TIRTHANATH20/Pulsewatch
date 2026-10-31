# PROJECT_SPEC.md — PulseWatch

## Portfolio data

Synthetic portfolio holdings and P&L were prototype UI and have been
removed. Watchlists contain tracked symbols, not quantities or purchase
prices, so the application does not invent holdings or cost basis. Real
portfolio reporting requires user-provided transaction or holdings data.

## A08 first-load and auth polish, and real-time updates

First real page load (or any hard refresh) shows a full-screen black
`PulseWatchIntro` splash — a ~1.7-1.8s letter-by-letter "PulseWatch..." reveal with a
blinking cursor — before the app content cross-fades in. It never replays on
client-side navigation within a session, and `prefers-reduced-motion`
collapses it to a brief fade of the finished word.

`/login` and `/signup` keep their purple ambient identity (green stays the
product/action accent). The glow slowly loops around the full boundary of
the screen — all four corners, not just one side — instead of sitting
static in a corner, and no longer fades out as it nears the edges (the
page's vignette was quietly overpainting it there). The background waves
are dimmed but visibly moving, with the purple layers lightened to a pale
violet so they read clearly rather than dark/muddy — all so the auth form
stays the clear visual focal point rather than competing with the backdrop.

Separately, the "since your last visit" feed, header freshness readout, and
watchlist rows now refresh themselves every 25 seconds in the background
(silent — no loading-flash, paused while the tab isn't visible), so prices
and attention state stay current without a manual refresh click. See
ARCHITECTURE.md's "A08
architecture additions" and DECISIONS.md #38-45 for implementation detail.

## A07 market-intelligence additions

The product's primary dashboard hierarchy is “Since your last visit” followed
by an observation-derived Market snapshot and Market View. Portfolio value,
invested value, and P&L are intentionally not shown because PulseWatch has no
holdings or transaction model.

Market View supports line, area, bars, true OHLC candlesticks, derived
Heikin-Ashi, derived Renko, and an equal-sized responsive Market Map. History
is obtained through the `MarketDataProvider` abstraction and is explicitly
labeled as demo or provider data. Provider failure renders unavailable data;
the UI does not invent current prices.

## Original project brief (historical)

This is the original brief the base watchlist application was built
against, kept here for historical context; the application has since
been extended with an NLP-powered intelligence layer (see
NLP_ARCHITECTURE.md).

Build a **Smart Market Watchlist**. Minimum requirements:

1. Users can create and manage watchlists.
2. Users can view latest market information.
3. Users can return later and see what has meaningfully changed since
   they last checked.

Evaluated on: Engineering Depth, Product & Problem Interpretation, Edge
Cases & Resilience, Code Quality & Simplicity, Originality & Thoughtfulness.

The product should answer: **"What meaningfully changed since I last
checked, and what deserves my attention now?"**

## Product vision

PulseWatch is not a stock ticker. It is an attention-prioritization tool.
Instead of asking the user to scan every instrument on every visit, it
compares the current state of the market to what the user last saw, and
surfaces only what is meaningful — with a stated reason why.

## Functional requirements

- Users can create, rename, and delete watchlists.
- Users can add and remove instruments from a watchlist.
- Users can view the latest known price for each instrument on a
  watchlist.
- The system tracks price history per instrument (not just latest price)
  so that "previous observed price" and "change since last visit" can be
  computed rather than guessed.
- The system tracks, per user, when a watchlist (or instrument) was last
  viewed, so "meaningful change" can be computed relative to that visit.
- The system computes a meaningful-change score/severity per instrument
  per user, with a human-readable reason.

## Non-functional requirements

- **Correctness**: change calculations must be derived from stored
  historical data, never guessed or fabricated.
- **Reliability**: a failure in the market-data provider must not corrupt
  stored data or crash the app; the last known good data should still be
  servable, marked as stale.
- **Resilience**: the system should be explicit about data freshness
  (`observedAt` timestamps) rather than silently presenting stale data as
  current.
- **Simplicity**: modular monolith, no premature infrastructure
  (no microservices, no message queues, no cache layer) unless a concrete
  need is demonstrated.
- **Maintainability**: clear module boundaries so watchlist logic, market
  data, and change-detection can evolve independently.

## Important product principles

- Never fabricate market data or change scores — every claim on screen
  must be traceable to a stored observation.
- Data freshness is a first-class concept, not an afterthought.
- "Meaningful" change is a defined, explainable calculation, not a black
  box — the UI should be able to say *why* something was highlighted.

## Implemented features (Iteration 6, current — final UI polish pass)

Iteration 6 is a visual redesign only — no backend, data model, or
attention-logic changes. The brief called for a premium dark
fintech "market-intelligence command center" look (Groww-inspired
green accent, glass surfaces, editorial serif headings, calm motion)
applied to the existing architecture. See ARCHITECTURE.md → "UI layer
(Iteration 6)" and DECISIONS.md for what changed and, importantly,
what was deliberately *not* added (Tailwind, Framer Motion, Lucide —
see the decision entry on why a from-scratch dark re-theme of the
existing hand-written CSS was chosen over adopting a new UI stack).

Visual changes:

- Full dark re-theme (`globals.css`): near-black surfaces, a single
  Groww-inspired green (`#00C853`) accent, restrained red/amber status
  colors, a subtle radial glow, Inter for UI text and Instrument Serif
  for editorial headings, all via plain CSS custom properties — no new
  dependency.
- **"Since your last visit" is now the visual centerpiece**
  (`AttentionSection.tsx`): a glass hero panel with a dynamic
  "N meaningful changes" count, before/after price comparison
  (`previous → current`) on every notable card, and a calm staggered
  entrance animation (CSS `@keyframes` + `animation-delay`, respecting
  `prefers-reduced-motion`).
- NEW is now promoted into the notable ("meaningful") card set
  alongside SIGNIFICANT/CHANGED, matching the attention hierarchy in
  this document; STALE/UNCHANGED/UNAVAILABLE remain collapsed in the
  "quiet" list, unchanged from Iteration 4/5's behavior.
- Ticker + company name are now both shown (the `name` field already
  existed on `AttentionItemDTO`/`WatchlistItemDTO` — this iteration is
  the first to render it) on attention cards and watchlist item rows.
- `AppHeader` gained a real freshness readout ("Updated N min ago")
  and a refresh control, both wired to the existing `useAttention()`
  hook — no new endpoint.
- Dashboard statistics consolidated into a 4-metric strip (Watchlists,
  Tracked stocks, Meaningful changes, Data freshness) instead of the
  prior two separate significant/changed cards.
- Editorial page intro ("Here's what changed.") added above the
  metrics strip on the dashboard.
- No functional, API, or attention-engine change. All 28 existing
  unit tests pass unmodified; see PROGRESS.md → ITERATION 6 (I06)
  CHECKPOINT.

**I06 refinement pass** (after reviewing the first I06 checkpoint):
corrected SIGNIFICANT to colour by movement direction instead of
always red (green for a significant gain, red for a significant drop,
neutral for zero movement — DECISIONS.md #25/#26), widened the desktop
content column (900px → 1120px) so the attention card's five pieces of
information have room to breathe, reordered the dashboard so "Since
your last visit" renders ahead of the statistics strip rather than
after it, and hardened mobile CSS against overflow/cramping (wrapping
comparison text, a narrower header freshness readout, wrapping item-row
buttons). Still no functional/API/attention-engine change; all 28 tests
still pass. See PROGRESS.md → I06 REFINEMENT CHECKPOINT.

## Implemented features (Iteration 5 — final development iteration)

Iteration 5 is an accessibility/polish pass on the Iteration 4 UI
(keyboard focus trap and ARIA live regions on the confirm dialog and
loading/error states, a visible focus ring, a couple of missing hover
states, mobile layout tightening for the dialog and stat grid). No
functional requirement below changed; see PROGRESS.md → ITERATION 5
(I05) CHECKPOINT for the full list.

## Implemented features (Iteration 4)

- Watchlist CRUD (API + UI): create, rename, delete. *(Iteration 2,
  unchanged this iteration.)*
- Add/remove symbols on a watchlist, with duplicate prevention.
  *(Iteration 2, unchanged.)*
- Anonymous, cookie-scoped identity as a placeholder for real
  authentication (see DECISIONS.md #7) — not a substitute for the "User
  identity / authentication" item below, which still means a real,
  user-controlled login. *(Iteration 2, unchanged.)*
- **Market data ingestion** (`src/server/modules/market/`): a Twelve Data
  provider behind a swappable factory, an in-memory rate limiter, a
  request timeout, append-only `PriceObservation` persistence, and
  graceful fallback to the last known price (marked stale) or
  "unavailable" on provider failure.
- **"Last seen" state per user per instrument** (`LastSeenState` Prisma
  model): the baseline the attention engine diffs the current price
  against.
- **Meaningful-change scoring engine** (`src/server/modules/attention/`):
  a pure, deterministic function producing one of
  NEW / UNCHANGED / CHANGED / SIGNIFICANT / STALE / UNAVAILABLE per
  instrument, with a human-readable reason, previous/current price,
  absolute and percentage change, and a 0–100 attention score used for
  sort order.
- **`GET /api/attention`** — the current user's attention state across
  all (or one) of their watchlists, ownership-scoped the same way the
  watchlist endpoints are, sorted so significant/changed items rise to
  the top.
- **"Since your last visit" UI** — a shared `AttentionSection` component
  used on both the dashboard and the per-watchlist detail page: notable
  changes (CHANGED/SIGNIFICANT) shown as cards with previous→current
  price, % move, severity badge, and reason; NEW/UNCHANGED/STALE/
  UNAVAILABLE collapsed into a quieter, expandable list. Skeleton
  loading, empty state, and error-with-retry all included.
- **Simulated market-data provider** (`src/server/modules/market/providers/simulated.provider.ts`),
  selected via `MARKET_DATA_PROVIDER=simulated` (an explicit demo option): a
  deterministic-ish random-walk quote generator implementing the exact
  same `MarketDataProvider` interface as the Yahoo Finance and Twelve Data providers, so
  the whole app — including the reliability/fallback logic above — can
  be exercised with zero external configuration. Explicitly
  development/demo only; see README.md "Demo flow".
- **Redesigned UI** — a Groww-inspired fintech visual direction (green
  accent, light neutral surfaces, dark charcoal text, restrained status
  colors, strong numeric typography) applied to PulseWatch's own
  "command center" layout: an `AppHeader` on every page, a dashboard
  stat strip (watchlists, symbols tracked, significant moves, changed),
  live price + freshness badges on watchlist item rows (via a shared
  `useAttention` hook, not a second API), a `ConfirmDialog` for
  destructive actions in place of `window.confirm`, a first-run empty
  state, and responsive layout down to narrow/mobile widths.

## Planned features (not yet implemented)

- User identity / authentication (real login, not the anonymous
  placeholder above).
- Volatility-context or time-weighted scoring (the current engine scores
  purely on % move magnitude relative to fixed thresholds — see
  DECISIONS.md for why that scope was chosen).
- Automated tests for the market module and the UI components — `env.ts`
  config validation, the attention engine, and watchlist input
  validation have unit test coverage as of the final static audit (see
  PROGRESS.md → FINAL STATIC AUDIT); the market module's provider/
  service logic and every React component are still untested.
- Live verification against a running Twelve Data account and a real
  PostgreSQL database — this sandbox cannot reach either, nor `npm`'s
  registry (see PROGRESS.md → KNOWN LIMITATIONS).
- Additional market-data providers beyond `yfinance`/`simulated`/`twelvedata`
  (the factory pattern already supports adding one without touching
  callers — see ARCHITECTURE.md).

## Important edge cases

Handled as of Iteration 2 (unchanged):

- Duplicate instrument added to the same watchlist — rejected with a
  409 Conflict, both via a service-layer pre-check (friendly error
  message) and the database's unique constraint on
  `(watchlistId, instrumentId)` (actual source of truth, race-safe).
- Deleting/renaming a watchlist that doesn't exist or belongs to another
  user — both return 404, deliberately indistinguishable from each other
  so existence isn't leaked.
- Empty/whitespace-only watchlist names or symbols — rejected by zod
  validation (400) before reaching the database.

Handled as of Iteration 3 (new):

- **User has never visited a watchlist before** — no `LastSeenState` row
  exists, so the engine reports NEW rather than UNCHANGED/CHANGED
  against a nonexistent baseline.
- **Market data provider is down, errors, or is rate-limited at read
  time** — `market/service.ts` falls back to the latest stored
  `PriceObservation` (status STALE) or, if none exists yet, UNAVAILABLE.
  Never throws out of the request.
- **An instrument has no price history yet** — same UNAVAILABLE path as
  above; the attention engine reports it explicitly rather than showing
  a fabricated or blank price.
- **Concurrent/repeated refreshes for the same user+instrument** —
  `LastSeenState` is only advanced *after* the current comparison is
  computed, and only when a price was actually obtained, so repeated
  calls converge rather than compound drift.
- **Multiple instruments in one request** — each instrument is evaluated
  independently (`attention/service.ts`); one instrument's failure marks
  only that instrument UNAVAILABLE and never fails the rest of the
  response.
- **A watchlistId that doesn't exist, or belongs to another user** —
  `GET /api/attention?watchlistId=...` returns an empty `items` array,
  the same don't-leak-existence pattern as the watchlist endpoints.

Still open (see PROGRESS.md → Remaining Work):

- Clock/timestamp skew between observation time and detection time —
  not specifically compensated for; `observedAt` is trusted as given by
  the provider/clock.
- Distributed rate limiting — the current limiter is per-process (see
  DECISIONS.md); a multi-instance deployment would need a shared limiter.

## Constraints

- 72-hour engineering challenge — scope must stay realistic.
- Must be simple enough to explain and defend in a university NLP course review.
- Stack: Next.js + TypeScript + PostgreSQL + Prisma, modular monolith.
