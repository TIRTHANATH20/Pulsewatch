# ARCHITECTURE.md — PulseWatch

## System flow (current)

```
Watchlist (CRUD, ownership)
      │  add/remove symbol
      ▼
Market Data (provider abstraction: yfinance | twelvedata | simulated demo)
      │  every successful read
      ▼
PriceObservation (append-only history, Prisma)
      │  read as "previous" baseline
      ▼
LastSeenState (per user, per instrument)
      │  diffed against a fresh quote
      ▼
Attention Engine (pure NEW/UNCHANGED/CHANGED/SIGNIFICANT/STALE/UNAVAILABLE classifier)
      │
      ▼
Attention API (GET /api/attention — ownership-scoped, sorted)
      │
      ▼
UI ("since your last visit": AttentionSection, dashboard stats, watchlist item rows)
```

Every arrow above is real and implemented as of this iteration — see
"Major modules" below for what's CURRENT vs. what's still FUTURE
(user auth, additional providers, volatility-aware scoring).

## Current architecture 

A single Next.js application (App Router) acting as a modular monolith:
the frontend and backend live in one deployable unit, but backend logic
is organized into independent modules under `src/server/modules/*` so it
can be reasoned about (and later extracted) independently.

```
pulsewatch/
├── src/
│   ├── app/                              # Next.js App Router (frontend + API routes)
│   │   ├── layout.tsx                    # Imports globals.css
│   │   ├── page.tsx                      # Renders <WatchlistsDashboard />
│   │   ├── globals.css                   # Hand-written CSS, no framework
│   │   ├── watchlists/[id]/page.tsx      # Renders <WatchlistDetail id=... />
│   │   ├── components/
│   │   │   ├── AppHeader.tsx             # 'use client' (since I06) — persistent brand bar, rendered by layout.tsx
│   │   │   ├── AttentionSection.tsx      # 'use client' — "since your last visit" feed (uses useAttention)
│   │   │   ├── ConfirmDialog.tsx         # 'use client' — reusable confirm modal, replaces window.confirm
│   │   │   ├── MarketPulse.tsx           # 'use client' (I07) — SVG/CSS-3D network visualization of real watchlist activity
│   │   │   ├── MarketSnapshot.tsx        # 'use client' (I07) — gainers/decliners/unchanged + highlights, derived client-side
│   │   │   ├── Sparkline.tsx             # (I07) — SVG polyline from real PriceObservation history
│   │   │   ├── WatchlistsDashboard.tsx   # 'use client' — list/create/rename/delete + Market Pulse + Market Snapshot
│   │   │   └── WatchlistDetail.tsx       # 'use client' — one watchlist + its items, live price rows + sparklines
│   │   ├── hooks/
│   │   │   └── useAttention.ts           # 'use client' — shared fetch/loading/error for /api/attention
│   │   └── api/
│   │       ├── health/route.ts                          # GET
│   │       ├── attention/route.ts                       # GET
│   │       └── watchlists/
│   │           ├── route.ts                             # GET, POST
│   │           └── [id]/
│   │               ├── route.ts                         # GET, PATCH, DELETE
│   │               └── items/
│   │                   ├── route.ts                     # POST
│   │                   └── [itemId]/route.ts             # DELETE
│   ├── lib/
│   │   ├── api-client.ts        # Client-safe fetch wrapper; the ONLY thing
│   │   │                         # components use to reach the API
│   │   └── format.ts            # Shared price/percent/freshness formatting,
│   │                             # used by AttentionSection, WatchlistsDashboard,
│   │                             # and WatchlistDetail so they render identically
│   ├── types/
│   │   ├── watchlist.ts         # Shared watchlist DTOs
│   │   └── attention.ts         # Shared attention DTOs — same no-server-import
│   │                             # convention as watchlist.ts
│   └── server/
│       ├── db/
│       │   └── prisma.ts        # Prisma client singleton
│       ├── lib/
│       │   ├── env.ts           # Validated environment config (zod) — now also
│       │   │                     # covers market-data and attention-threshold config
│       │   ├── current-user.ts  # Anonymous cookie-backed user resolution
│       │   └── api-response.ts  # Domain error -> HTTP JSON response mapping
│       └── modules/
│           ├── watchlist/       # IMPLEMENTED (Iteration 2, unchanged)
│           │   ├── service.ts       # All business logic (CRUD, items)
│           │   ├── validation.ts    # zod schemas for API inputs
│           │   ├── errors.ts        # NotFoundError, DuplicateItemError, ValidationError
│           │   └── index.ts         # Barrel export
│           ├── market/          # IMPLEMENTED; Yahoo Finance via yfinance is the default, simulated data is opt-in demo only
│           │   ├── types.ts             # NormalizedQuote, MarketDataProvider, QuoteOutcome (+ volume/avgVolume, I07)
│           │   ├── errors.ts            # ProviderRequestError, ProviderTimeoutError, RateLimitExceededError
│           │   ├── rate-limiter.ts      # In-memory sliding-window limiter
│   │           ├── provider-factory.ts  # Resolves a provider from env config (yfinance | twelvedata | simulated)
│           │   ├── providers/
│           │   │   ├── simulated.provider.ts   # DEV/DEMO ONLY — curated named-symbol table + movement profiles (I07), no API key
│           │   │   └── twelve-data.provider.ts # Real quotes via Twelve Data
│           │   ├── repository.ts        # PriceObservation persistence + Instrument backfill + getRecentObservations (I07)
│           │   ├── service.ts           # getQuoteForInstrument (entry point) + getRecentPriceHistory (I07)
│           │   ├── index.ts             # Barrel export
│           │   └── README.md            # Module-local documentation
│           └── attention/       # IMPLEMENTED (Iteration 3) — see below
│               ├── config.ts            # Centralized, env-backed thresholds
│               ├── lastSeenRepository.ts # LastSeenState persistence
│               ├── engine.ts            # Pure comparison/scoring function
│               ├── service.ts           # getAttentionForUser — orchestration + ownership
│               └── index.ts             # Barrel export
├── prisma/
│   └── schema.prisma            # + LastSeenState (Iteration 3, new).
│                                 # User, Watchlist, WatchlistItem, Instrument,
│                                 # PriceObservation unchanged from Iteration 1.
├── tests/
│   └── unit/env.test.ts         # Still the only test file — see
│                                 # PROGRESS.md → REMAINING WORK
└── (config files: tsconfig, eslint, vitest, next.config)
```

## Frontend structure

App Router (`src/app`) with two real routes:

- `/` — `WatchlistsDashboard` (client component): lists the current
  user's watchlists, lets them create one, rename one inline, or delete
  one. Handles loading/empty/error states itself; no server-rendered data
  fetching is used here so the same component can optimistically update
  its local state after a mutation without a full page reload.
- `/watchlists/[id]` — `WatchlistDetail` (client component): shows one
  watchlist's symbols, lets the user rename/delete the watchlist itself,
  and add/remove symbols. Same loading/empty/error pattern.

Both routes also render `AttentionSection` (`src/app/components/
AttentionSection.tsx`) — the "Since your last visit" feed. It's the same
component in both places, parameterized by an optional `watchlistId` and
a `showWatchlistName` flag, so the attention-rendering logic (cards,
badges, the collapsed "quiet" list for NEW/UNCHANGED/STALE/UNAVAILABLE
items, skeleton loading) is written once. Neither page nor either client
component contains any change-detection logic itself — they only call
`GET /api/attention` through `src/lib/api-client.ts`'s `fetchAttention()`
and render whatever it returns; all business rules for what counts as
NEW/CHANGED/SIGNIFICANT live server-side in `src/server/modules/attention`
(see below and DECISIONS.md).

**`useAttention` (new this iteration)** — `src/app/hooks/useAttention.ts`
extracts the fetch/loading/error state machine that used to live only
inside `AttentionSection` into a shared hook. Three surfaces use it now:
`AttentionSection` itself (the feed), `WatchlistsDashboard` (the stat
strip — significant/changed counts), and `WatchlistDetail` (per-symbol
live price + freshness badge on each item row, joined client-side by
`itemId` against the same attention response). All three hit the same
`GET /api/attention` request pattern, so this is one extra request per
mounted surface, not a new endpoint or a new server round trip per row.

**`ConfirmDialog` (new this iteration)** — `src/app/components/
ConfirmDialog.tsx` is a small dependency-free modal that replaces the
earlier `window.confirm`/`alert` calls in `WatchlistsDashboard` and
`WatchlistDetail` for destructive actions (delete watchlist, remove
symbol). It's a controlled component (`open`/`onConfirm`/`onCancel`)
with no internal fetch logic — the parent still owns the actual API call
and its busy/error state, exactly as before.

**`AppHeader`** — `src/app/components/AppHeader.tsx` is rendered once by
`layout.tsx`, so it appears on every route without each page needing to
include it. As of Iteration 6 it is a client component: it calls the
same `useAttention()` hook the rest of the app uses (no new endpoint)
to derive a real "Updated N min ago" freshness readout and drive a
manual refresh control, which a server component couldn't do.

Both page files under `src/app` (`page.tsx`,
`src/app/watchlists/[id]/page.tsx`) are themselves plain server
components that do nothing but render the corresponding client component
— this keeps the route-definition files trivial and puts all state/logic
in `src/app/components/*`, which is easier to test and reason about in
isolation.

Data fetching from components goes exclusively through
`src/lib/api-client.ts`, a thin `fetch` wrapper around the `/api/*`
routes below (never a direct Prisma import — that would pull server-only
code into the browser bundle). `src/types/watchlist.ts` defines the DTO
shapes both sides agree on.

No component library, state management library, or CSS framework was
introduced — `src/app/globals.css` is plain hand-written CSS, a small
design system of CSS custom properties (`:root` variables for
color/radius/shadow/motion easing) rather than one-off values, so the
Groww-inspired fintech direction is applied consistently rather than
per-component. React's built-in `useState`/`useEffect` (via
`useAttention`) remains sufficient at this scope.

### UI layer (Iteration 6)

Iteration 6 re-themed `globals.css` from Iteration 4's light palette to
a dark, glass-surfaced "market-intelligence command center" look —
near-black surfaces, a Groww-inspired green accent (`#00C853`),
restrained red/amber status colors, Inter for UI text, and Instrument
Serif for editorial headings (`.page-heading`, `.section-heading`,
`.first-run-title`) — entirely within the existing plain-CSS approach.
No Tailwind, Framer Motion, or Lucide were added; see DECISIONS.md #24
for why. Entrance motion for attention cards and the confirm dialog
uses CSS `@keyframes` with per-card `animation-delay` staggering
(`.attention-card:nth-child(n)`), gated behind
`@media (prefers-reduced-motion: reduce)`. `.liquid-glass` is a reusable
class (backdrop blur + translucent border) applied to the header pill
and the "Since your last visit" hero panel only — deliberately not
extended to individual rows/cards, per the brief's guidance not to
overuse glass on every surface.

**I06 refinement pass** — a follow-up correction pass against the same
brief, scoped to specific issues found on review of the first I06
checkpoint:

- **SIGNIFICANT colour semantics** (DECISIONS.md #25): the badge and
  card border/background for SIGNIFICANT items now follow movement
  direction — green for a significant gain, red for a significant
  drop, neutral white/gray for the (practically unreachable) zero-
  movement case — via explicit `.is-positive`/`.is-negative` modifier
  classes computed from `absoluteChange`'s sign at every render site
  (`AttentionSection`, `WatchlistDetail`'s item rows), not a single
  ancestor-scoped CSS rule. CHANGED's border was also detinted to
  neutral so it reads as a visible step below SIGNIFICANT
  (DECISIONS.md #26).
- **Desktop content width**: `--content-max-width` increased from
  `900px` to `1120px` (also now driving the header pill's max-width,
  which previously used a separate hardcoded `1080px`), giving the
  attention card's three-column grid (ticker/company · price/movement ·
  previous→current/reason/freshness) enough room without stretching
  the page edge-to-edge.
- **Visual hierarchy reordered**: `WatchlistsDashboard` now renders
  `AttentionSection` immediately after the page intro, ahead of the
  metrics strip (previously the metrics strip came first). The metrics
  strip itself was made visually smaller/quieter (smaller type, thinner
  padding, no border-radius bump) so it reads as secondary context
  rather than competing with "Since your last visit" for attention.
- **Mobile overflow hardening**: `overflow-x: hidden` added at the
  `html`/`body` level as a defensive backstop; `.attention-compare`
  (the previous→current row) now wraps instead of forcing a fixed-width
  line; the header's freshness *text* (not the live-status dot) hides
  below 480px so brand + freshness sentence + refresh button don't
  contend for space on narrow phones; `.item-row-price` wraps on
  mobile so the remove button never gets squeezed against the price.
- Removed one small piece of dead/duplicate CSS (a `.app-nav` mobile
  rule that duplicated the class's own `display: none` default).

No component gained or lost functionality in this pass — it is a CSS
and class-name/prop-computation refinement only. See PROGRESS.md → I06
REFINEMENT CHECKPOINT for the full verification record.

### UI layer (Iteration 7 — "Market UI & synthetic data")

I07 is the first iteration to add a real UI dependency
(`framer-motion` — see DECISIONS.md #27) and two new presentational data
fields (`sparkline`, `volume`/`avgVolume` on `AttentionItemDTO` — see
DECISIONS.md #29/#30) on top of the same attention pipeline. No change
to the attention engine, the API's response shape's *meaning*, ownership
rules, or the watchlist module.

New components (`src/app/components/`):

- `Sparkline.tsx` — a small SVG polyline renderer that takes a
  `number[]` and draws a line proportional to that array's own min/max —
  no hardcoded path data. Used by `AttentionSection` (attention cards)
  and `WatchlistDetail` (holding rows), both fed by the same
  `AttentionItemDTO.sparkline` field.
- `MarketPulse.tsx` — the "Market Pulse" visualization (PROJECT_SPEC's
  "PulseWatch is watching the market" requirement): an SVG network of
  up to 8 nodes, one per real tracked instrument (capped by
  `attentionScore`, which the API already sorts by), colored by real
  movement direction/status, sized by real `attentionScore`, with a
  pulsing halo reserved for `SIGNIFICANT` items. A lightweight CSS
  `perspective` + `framer-motion` spring gives it a pointer-reactive 3D
  tilt (see DECISIONS.md #31 for why this isn't `three.js`). Rendered on
  the dashboard, directly after `AttentionSection`.
- `MarketSnapshot.tsx` — a compact, secondary summary (tracked stocks /
  gainers / decliners / unchanged, plus "biggest mover" and "most
  active") computed client-side from the same `attentionItems` array
  `AttentionSection` already renders as cards — no new endpoint, no
  fabricated figures.

Changed components:

- `AttentionSection.tsx` — `AttentionCard`'s entrance/stagger and
  hover-lift moved from CSS `@keyframes`/`nth-child` delays to
  `framer-motion` (`custom={index}` variants, `whileHover`), gated by
  `useReducedMotion()`. Cards now render a `Sparkline` next to the price
  delta and a volume figure in the footer when available. Empty/
  no-notable-change copy aligned to the brief's exact wording
  (DECISIONS.md #33).
- `WatchlistsDashboard.tsx` — wrapped in a `framer-motion` page-entrance
  fade/rise; renders `MarketPulse` and `MarketSnapshot` (replacing the
  old inline 4-metric strip) directly after `AttentionSection`; shows an
  explicit "Simulated Market Data — for demo purposes only" tag in the
  page intro (PROJECT_SPEC's synthetic-data labeling requirement).
- `WatchlistDetail.tsx` — same page-entrance motion; holding rows now
  render a compact `Sparkline` next to the live price; empty-holdings
  copy aligned to the brief.
- `AppHeader.tsx` — the freshness indicator now carries a `title`
  tooltip clarifying the data is simulated, visible on every route (not
  just the dashboard's page-intro tag).

Server-side additions supporting the above (all additive, no existing
field/behavior removed):

- `market/types.ts` — `NormalizedQuote`/`QuoteOutcome`'s `"fresh"`
  variant gained optional `volume`/`avgVolume` fields.
- `market/providers/simulated.provider.ts` — rewritten around a curated
  table of 15 named symbols with per-symbol movement profiles
  (trend-up/trend-down/stable/volatile) instead of one generic
  random-walk model; see DECISIONS.md #28 for the full rationale and
  `README.md`'s "Simulated provider" section below for the symbol list.
- `market/repository.ts` — new `getRecentObservations(instrumentId,
  limit)`, a read-only query over the existing `PriceObservation` table
  (no schema change).
- `market/service.ts` — new `getRecentPriceHistory(instrumentId, limit)`,
  a thin public wrapper over the above; the `"fresh"` `QuoteOutcome` now
  carries `volume`/`avgVolume` straight from the provider.
- `attention/service.ts` — `evaluateOne` now also fetches the sparkline
  history and reads `volume`/`avgVolume` off the outcome (when
  `"fresh"`), attaching both to the DTO via `toDTO`'s new optional
  `extra` parameter. `engine.ts` itself was not modified — see
  DECISIONS.md #30 for why this was deliberately layered outside the
  pure classifier.
- `src/types/attention.ts` — `AttentionItemDTO` gained `sparkline:
  number[]`, `volume: number | null`, `avgVolume: number | null`.
- `src/lib/format.ts` — new `currencySymbolFor`/
  `formatPriceWithCurrency`/`formatVolume` helpers (DECISIONS.md #32).

No component gained a server-only import; all new data still flows
through the same `GET /api/attention` response `AttentionSection`,
`WatchlistsDashboard`, and `WatchlistDetail` already fetch via
`useAttention()` — see "Data flow" below, which is otherwise unchanged
by this iteration.

## Backend structure

Backend logic lives under `src/server`, not inside `src/app/api`
directly. Route handlers in `src/app/api/**/route.ts` are kept thin: they
resolve the current user, parse/validate the request, call into
`src/server/modules/watchlist/service.ts`, and map the result (or a
thrown domain error) to an HTTP response via
`src/server/lib/api-response.ts`. This keeps business logic testable
without spinning up the Next.js HTTP layer, and keeps the option open to
move `src/server` into a standalone service later without touching route
wiring more than necessary.

- `src/server/db/prisma.ts` — single cached `PrismaClient` instance
  (prevents connection-pool exhaustion under Next.js dev hot-reload).
- `src/server/lib/env.ts` — validates required environment variables at
  startup using `zod`, so misconfiguration fails fast with a clear
  message instead of a confusing runtime error later.
- `src/server/lib/current-user.ts` — resolves (and, on first visit,
  creates) the current anonymous `User` via an httpOnly cookie. This is a
  deliberate placeholder for real authentication (see DECISIONS.md #7)
  and is the *only* place that knows about cookies or creates users —
  every other function downstream takes a plain `userId: string`.
- `src/server/lib/api-response.ts` — maps thrown domain errors
  (`NotFoundError` → 404, `DuplicateItemError` → 409, `ValidationError` /
  `ZodError` → 400, anything else → 500) to a consistent
  `{ error, message, issues? }` JSON body. Every route handler funnels its
  catch block through this.
- `src/server/modules/watchlist/` — **implemented this iteration**:
  - `service.ts` — all watchlist business logic: list/create/rename/
    delete watchlists, add/remove symbols. Every mutating operation
    starts by confirming the watchlist exists AND belongs to the calling
    user (`requireOwnedWatchlist`), throwing the same `NotFoundError` for
    both "doesn't exist" and "belongs to someone else" so existence is
    never leaked.
  - `validation.ts` — zod schemas for watchlist names and symbols,
    shared by every route handler that accepts them.
  - `errors.ts` — plain `Error` subclasses with no HTTP knowledge, so the
    service layer stays framework-agnostic.
- `src/server/modules/market/` — **implemented this iteration**. Its
  single entry point, `getQuoteForInstrument({ id, symbol })`
  (`service.ts`), returns a `QuoteOutcome` (`"fresh"`, `"stale"`, or
  `"unavailable"`) and never throws a raw provider error to its caller:
  - `rate-limiter.ts` — an in-memory sliding-window limiter checked
    first; a denied request skips the provider entirely and goes
    straight to fallback.
  - `provider-factory.ts` — resolves a `MarketDataProvider` from
    `MARKET_DATA_PROVIDER`: `"yfinance"` (default — Yahoo Finance via
    the Python NLP service), `"twelvedata"` (real quotes), or
    `"simulated"` (explicit demo-only random-walk data). All implement
    the same `MarketDataProvider` interface from `types.ts`, so
    `service.ts` and everything downstream (the attention module) never
    know or care which one is active — adding a third provider later is
    a new factory case, not a rewrite. **Provider abstraction is the
    key property here**: rate limiting, timeout handling,
    `PriceObservation` persistence, and stale/unavailable fallback all
    live in `service.ts`, above the provider boundary, so switching
    providers changes nothing about reliability behavior.
  - The provider call is wrapped in an `AbortController` timeout
    (`MARKET_DATA_TIMEOUT_MS`).
  - On success: `repository.ts` persists an append-only
    `PriceObservation` row and best-effort backfills the placeholder
    `Instrument.name`/`exchange` values the watchlist module created
    (DECISIONS.md #10) — a persistence failure here is swallowed so it
    can't turn a successful price read into a user-facing error.
  - On any failure (rate limit, timeout, provider error): falls back to
    the latest stored `PriceObservation` from that same provider
    (`"stale"`, with a `reason`), or `"unavailable"` if none exists yet.
- `src/server/modules/attention/` — **implemented this iteration**. Its
  entry point, `getAttentionForUser(userId, watchlistId?)`
  (`service.ts`):
  - Loads the user's own watchlist items, scoped by `userId` in the
    Prisma query itself (the same ownership pattern as
    `requireOwnedWatchlist` — see DECISIONS.md #8) — an unrelated or
    nonexistent `watchlistId` yields an empty list, not an error.
  - For each instrument: reads its `LastSeenState` baseline **before**
    calling the market module or writing anything, calls
    `getQuoteForInstrument`, then calls the pure `engine.ts` function
    `computeAttention(previous, quote, thresholds)` to classify it.
  - Only *after* computing the result does it advance `LastSeenState` —
    and only when a price was actually obtained (not on `UNAVAILABLE`),
    so an outage doesn't reset a user's baseline.
  - Wraps each instrument's evaluation in its own try/catch so one
    instrument's unexpected failure can't fail the other instruments in
    the same response.
  - Sorts results so SIGNIFICANT/CHANGED rise to the top, then NEW, then
    STALE, then UNCHANGED, then UNAVAILABLE; ties broken by
    `attentionScore` descending.
  - `engine.ts` itself takes no DB/env dependencies — it's a pure
    function of `(previous, quote, thresholds)` — so it's the one part
    of this iteration most amenable to isolated unit testing (see
    PROGRESS.md → Remaining Work; none were added yet).

## API surface (unchanged since Iteration 3)

All routes resolve/create the anonymous current user via the `pw_uid`
cookie (see `current-user.ts`) and return JSON. Errors use the shape
`{ error: "<Kind>", message: "<human readable>", issues?: [...] }`.

| Method | Path | Description | Success | Errors |
|---|---|---|---|---|
| GET | `/api/watchlists` | List current user's watchlists | 200 | — |
| POST | `/api/watchlists` | Create a watchlist. Body: `{ name }` | 201 | 400 |
| GET | `/api/watchlists/:id` | Get one watchlist with its items | 200 | 404 |
| PATCH | `/api/watchlists/:id` | Rename. Body: `{ name }` | 200 | 400, 404 |
| DELETE | `/api/watchlists/:id` | Delete (cascades to its items) | 204 | 404 |
| POST | `/api/watchlists/:id/items` | Add a symbol. Body: `{ symbol }` | 201 | 400, 404, 409 |
| DELETE | `/api/watchlists/:id/items/:itemId` | Remove a symbol | 204 | 404 |
| GET | `/api/attention` | Attention state for all the user's instruments. Optional `?watchlistId=` scopes to one watchlist | 200 | — |

`GET /api/health` (Iteration 1) is unchanged. `GET /api/attention` never
returns 404 for an unowned/nonexistent `watchlistId` — it returns 200
with an empty `items` array, matching the ownership-hiding pattern used
elsewhere (DECISIONS.md #8).

## Database direction

PostgreSQL via Prisma. The schema (`prisma/schema.prisma`) currently
models:

- `User` — identity placeholder (auth mechanism not yet decided).
- `Watchlist` — owned by a `User`.
- `WatchlistItem` — join table between `Watchlist` and `Instrument`.
- `Instrument` — a trackable symbol (e.g. a stock).
- `PriceObservation` — an **append-only** log of price readings per
  instrument. Price history is stored explicitly rather than overwriting
  a single "current price" field, because "previous observed price" and
  "meaningful change since last visit" both require historical data —
  computing them from a single mutable field would be either impossible
  or would require guessing.

- `LastSeenState` (**new this iteration**) — one row per `(userId,
  instrumentId)`, storing the price and observation timestamp the user
  last saw. This is the baseline `attention/engine.ts` diffs the current
  quote against. Deliberately keyed by instrument rather than by
  watchlist item: the same instrument can sit on several of a user's
  watchlists, and "has this user seen AAPL move" is a fact about the
  user and the instrument, not about which list surfaced it (see
  DECISIONS.md).

**Instrument placeholder values:** when a symbol is added to a
watchlist, `watchlist/service.ts` still upserts an `Instrument` row by
`symbol` with placeholder `name`/`exchange` values (`name = symbol`,
`exchange = "UNKNOWN"`) at creation time, since the watchlist module
itself has no market-data dependency (DECISIONS.md #10). **As of this
iteration**, `market/repository.ts`'s `backfillInstrumentMetadata` fills
in real values the first time a successful quote is fetched for that
instrument — but only while the placeholder is still in place, never
overwriting an already-resolved name/exchange.

## Data flow (current)

- `GET /api/health` → route handler → `prisma.$queryRaw\`SELECT 1\`` →
  reports `{ status, database, timestamp, responseTimeMs }`. Proves the
  database connection path works end-to-end; a liveness/readiness signal
  for later monitoring.
- Watchlist UI (`WatchlistsDashboard`, `WatchlistDetail`) → `src/lib/
  api-client.ts` (`fetch`) → `/api/watchlists/**` route handler →
  `current-user.ts` (resolve/create anonymous user) → `zod` validation →
  `watchlist/service.ts` → Prisma → PostgreSQL. Errors thrown by the
  service layer are caught in the route handler and mapped to an HTTP
  response by `api-response.ts`; the client component reads
  `error.message` from the JSON body and renders it in an error banner.
- **Attention feed (new this iteration):** `AttentionSection` (mounted on
  both `/` and `/watchlists/[id]`) → `api-client.ts`'s `fetchAttention()`
  → `GET /api/attention` → `current-user.ts` → `attention/service.ts`'s
  `getAttentionForUser`, which for each of the user's watchlist items:
  reads `LastSeenState` (Prisma) → calls `market/service.ts`'s
  `getQuoteForInstrument` (rate limiter → configured provider, with
  timeout and source-matched fallback to the latest `PriceObservation`) →
  `attention/engine.ts`'s pure `computeAttention` → writes the new
  `LastSeenState` baseline (Prisma) → returns a DTO. The route handler
  collects every item's DTO into `{ items }`, already sorted so
  significant/changed items are first.

## Major modules

| Module | Status | Responsibility |
|---|---|---|
| `server/db` | Implemented | Database connection lifecycle |
| `server/lib` | Implemented | Env validation, current-user resolution, error→HTTP mapping |
| `server/modules/watchlist` | **Implemented** | Watchlist CRUD, item add/remove, ownership |
| `server/modules/market` | **Implemented** | Provider abstraction (Yahoo Finance via yfinance by default; Twelve Data or simulated demo optional), rate limiting, timeout, source-aware persistence and fallback |
| `server/modules/attention` | **Implemented** | Last-seen baselines, deterministic change-detection engine, per-user attention feed |
| `app` (frontend) | **Implemented** | Command-center dashboard (Market Pulse + Market Snapshot + feed) and watchlist detail page (live price rows + sparklines + feed), shared header, shared confirm dialog (I05: keyboard focus trap + ARIA live regions; I07: `framer-motion` entrance/stagger, Market Pulse 3D visualization) |
| Real authentication | **FUTURE** | Anonymous cookie identity remains a placeholder (DECISIONS.md #7) |
| Volatility/time-weighted scoring | **FUTURE** | Engine currently scores on fixed % thresholds only |
| Automated UI/module tests | **PARTIAL** | Unit coverage for `env.ts`, the attention engine (classification/boundaries), and watchlist validation schemas. No React/component tests, no integration tests against a real database (see I05 static audit in PROGRESS.md) |

## Why this architecture was chosen

- **Modular monolith over microservices**: a 72-hour challenge with a
  single small team does not have the operational surface area to
  justify network calls between services, service discovery, or
  distributed tracing. A monolith with clear internal module boundaries
  gets the same maintainability benefit without the operational cost,
  and can be split later if genuinely needed (see DECISIONS.md).
- **Next.js App Router for both frontend and API**: avoids running two
  separate servers/deployments for a project of this scope, while still
  keeping backend logic out of the `app/` directory so it isn't
  tightly coupled to route file conventions.
- **Prisma over a raw query builder**: strong typing end-to-end from the
  schema, and migrations are tracked as code — important for a project
  reviewers will inspect for engineering rigor.
- **Append-only `PriceObservation`**: the entire product's value
  proposition ("what changed since I last checked") depends on having
  real history to diff against. Modeling this from the start avoids a
  painful schema migration later.
- **Anonymous cookie-backed identity instead of building auth now**: real
  authentication was deliberately deferred in Iteration 1 (DECISIONS.md
  #6) because the mechanism hadn't been chosen. Watchlist CRUD still
  needs *some* notion of "whose watchlist is this" to be usable and
  demoable, so Iteration 2 adds the smallest thing that provides real
  per-user data isolation without pre-committing to an auth mechanism:
  see DECISIONS.md #7.
- **Client components + a thin fetch wrapper over building the API into
  React Server Components' data fetching**: watchlist mutations
  (create/rename/delete/add/remove) need optimistic local UI updates and
  inline loading/error states per action (e.g. "deleting this one row"),
  which is simpler to express with client-side state than by
  round-tripping through server actions/revalidation for every
  interaction at this scope.
# Architecture additions

`MarketDataProvider` now exposes `fetchHistory(symbol, range, signal)` in
addition to quotes. Providers normalize into `HistoricalBar` (timestamp, open,
high, low, close, optional volume). The service owns timeout handling and the
API route checks that the symbol belongs to the current user.

Chart transformations are pure functions: OHLC → Heikin-Ashi and OHLC → Renko.
The UI never stores duplicate visualization data. Market Map tiles use equal
responsive sizing because market capitalization and allocation are not owned by
PulseWatch; movement color and attention state come from the attention feed.

Freshness remains observation-based. Live provider reads are persisted through
the existing quote pipeline; fallback quotes are marked stale and provider
failures never become fabricated current values. Authentication, ownership
checks, last-seen baselines, and the modular-monolith boundaries are unchanged.

# Architecture additions — intro splash + auth ambience polish + real-time polling

**Current implementation** (not planned/future — all of this is live):

- **`PulseWatchIntro.tsx`** (new, `src/app/components/`) is a client
  component that wraps `<AppHeader />` and `{children}` inside
  `layout.tsx`'s `<body>`. It renders a full-screen black overlay with a
  letter-by-letter "PulseWatch..." reveal (plain `setTimeout` chain, ~58ms
  per character) plus a blinking cursor, then fades the overlay out
  while cross-fading the wrapped app content in via a
  `.pw-app-shell`/`.pw-app-shell.is-revealed` opacity+translateY pair in
  `globals.css`. It mounts once per real page load — Next's App Router
  keeps the root layout mounted across client-side navigation, so no
  session-storage flag or extra state was needed to prevent replay on
  re-renders. `prefers-reduced-motion` skips the per-character reveal
  and shows the finished word with a short fade instead; a `<noscript>`
  style block keeps the app content visible if JS never runs. No new
  dependency — plain React state/effects and CSS, per DECISIONS.md #24.
- **`HeroBackground.tsx`**'s auth-route purple orb (`AUTH_ORB_LOOP`)
  traces a slow (26s, `easeInOut`) loop through absolute `top`/`left`
  percentage keyframes around the full boundary of the screen —
  top-right corner → top-left → bottom-left → bottom-right → back —
  via the same Framer Motion `animate` pattern already used for its
  opacity/scale pulse. Two earlier versions were narrower: the first
  animated small pixel offsets from a fixed anchor (DECISIONS.md #39,
  read as a wobble, not travel); the second replaced that with
  top/left keyframes but kept the loop confined to the top-right
  quadrant (DECISIONS.md #42), which still read as "stuck on the right
  side." The current loop spans the whole screen (DECISIONS.md #43).
- `AUTH_WAVES` render as plain SVG `<path>`s with an
  `<animateTransform type="translate">` SMIL child — not a
  `motion.path` with a Framer Motion `y` transform. The Framer Motion
  version silently never animated (it doesn't drive `transform` on a
  bare `<path>`), which is why the waves initially rendered but didn't
  move; SMIL is the same technique the dashboard's ambient wave `<path>`
  already used one branch below in the same file (see DECISIONS.md
  #41). Opacity sits around 0.13-0.24, with the purple layers
  specifically using a lighter violet (`#d9ccff`) at the higher end of
  that range — the original mid-tone purple read as too dark/muddy
  against the near-black background (DECISIONS.md #43).
- **`AuthForm.tsx`** no longer renders its own inline `<svg
  className="auth-flowing-waves">` — that was a second, brighter wave
  layer stacked on top of `HeroBackground`'s auth wave set, which is
  what actually made the login/signup background feel visually loud.
  Removing the duplicate (rather than just dimming both) also deleted
  the now-dead `.auth-flowing-waves*` CSS rules.
- The purple/green accent split (DECISIONS.md, "secondary accent —
  purple") is unchanged: green stays the product/action color, purple
  stays the auth-page ambient identity color.
- `.hero-background.is-auth .hero-grid-fade` (`globals.css`) overrides
  the shared vignette so it stays transparent much further out (68% vs.
  the default 78%) and softens to a partial tint instead of solid
  `--color-bg`. The vignette paints last inside `.hero-background`, so
  once the orb's loop above started reaching the screen's left side and
  bottom corners, the default vignette was quietly erasing it there
  (DECISIONS.md #45).
- **`useAttention.ts`** (`src/app/hooks/`) now silently re-fetches
  `/api/attention` every 25 seconds (`POLL_INTERVAL_MS`) in addition to
  its existing manual `reload()`, so every surface built on this one
  shared hook — `AppHeader`'s freshness readout, both
  dashboard/watchlist-detail `AttentionSection` instances, watchlist
  item rows — gets real-time price/attention updates for free, with no
  per-surface wiring. The poll never flips `loadState` to `"loading"`
  (so the feed doesn't blank to a skeleton every 25s), swallows
  transient failures instead of surfacing the error state, and pauses
  while the tab is hidden (`document.hidden`). Plain `setInterval` —
  no WebSocket/SSE server, no new dependency (DECISIONS.md #44).

**Explicitly not done in this pass** (future ideas only, not
implemented): a global "skip intro" preference, session-storage-based
intro suppression across route-level remounts, or extending the
typewriter treatment to any other page.

# Historical prototype note — synthetic portfolio P&L

An earlier prototype displayed synthetic holdings and portfolio P&L.
Those components and their data generator have been removed. The current
dashboard only displays watchlist-based market observations; a real
portfolio feature would require user-provided holdings or transaction
records and is outside the current data model.
