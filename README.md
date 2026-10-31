# PulseWatch

## NLP-Powered Financial Market Intelligence — University NLP Course Project

PulseWatch is presented here as a Natural Language Processing course
project: a real, from-scratch NLP pipeline (classical, machine-learning,
and transformer-optional techniques) is applied to financial news and
combined with market data to explain *why* a stock's attention score
changed, not just *that* it changed. See **NLP_ARCHITECTURE.md** for the
full pipeline design, methodology classification, and architecture.

PulseWatch combines its existing price-based attention engine with a
real NLP pipeline over financial news: market data tells you **what**
happened to a stock, NLP tells you **why** it may have happened. See:

- **NLP_ARCHITECTURE.md** — full pipeline design (preprocessing, TF-IDF,
  embeddings, sentiment, NER, topics, classification, ABSA, keyphrases,
  similarity, events, summarization, clustering, attention scoring).
- **RAG_ARCHITECTURE.md** — the "Ask PulseWatch" retrieval-augmented Q&A
  layer (FAISS retrieval + grounded, anti-hallucination generation).
- **NLP_SETUP.md** — how to install and run the Python NLP service
  alongside the existing Next.js app, including optional transformer
  models (FinBERT, spaCy, sentence-transformers).
- **DATASET_SETUP.md** — where to place the Financial PhraseBank and a
  real financial news corpus.
- **DATASETS.md** — provenance and remaining sample datasets; they are
  not used as the default news feed.
- **MODEL_EVALUATION.md** — real, measured classical-vs-transformer
  metrics (never fabricated numbers).

New surfaces: the unified PulseWatch AI chat, which combines market data,
live news retrieval, sentiment/topic/event analysis and evidence citations,
and a `/nlp-demo` page for pasting arbitrary text through the full pipeline.
All existing
PulseWatch functionality (watchlists, market data, the price-based
attention engine, auth) is unchanged and works with zero Python
dependency if the NLP service isn't running (`NLP_FEATURE_ENABLED=false`
or the service is simply down) — see NLP_SETUP.md.

## PulseWatch AI — one unified multi-agent chatbot

PulseWatch now has **exactly one user-facing chatbot, "PulseWatch AI"** (`/chat`,
linked in the header). Every question and answer lives in that single
conversation; the six financial-intelligence agents run as LangGraph nodes in
the Python NLP service. News retrieval and NLP analysis remain available to the chat,
while the former standalone News Intelligence page was removed because it
duplicated the chat and often displayed empty panels. The `/api/rag/query`
API is unchanged.

### Architecture

```
Browser  ──POST /api/chat (NDJSON stream)──▶  src/app/api/chat/route.ts
                                                  │
                                      Python /chat/graph (LangGraph workflow)
                                                  │
        ┌─────────────────────────┬───────────────┴───────────────┐
 Market Context Agent     Financial News Research Agent            │   (parallel)
 market module (quotes,   NLP service news + filter/dedupe        │
 1M history, freshness)   + source preservation                   │
        │                          │                              │
        │              ┌───────────┴───────────┐                  │
        │      NLP Analysis Agent     Evidence Retrieval & RAG    │   (parallel)
        │      sentiment/NER/topics/  FAISS retrieval in the      │
        │      keyphrases/events      Python NLP service          │
        └──────────────┴───────────┬───────────┘                  │
                         Financial Explanation Agent  (LLM, or labelled fallback)
                                   │
                           Verification Agent  (citations, figures, dates,
                                   │            contradictions, causal claims, freshness, advice)
                                   ▼
                    one validated ChatResponse (answer + agents + sources + freshness)
```

The agent implementations live in `nlp-service/app/agents/` and are exposed
individually as well as through the graph. The Next.js boundary and zod response
schemas live in `src/server/modules/chat/`; UI: `src/app/components/PulseWatchChat.tsx`.

**Routing.** The Python graph resolves ticker symbols from full company names and
runs market context, news research, NLP analysis, evidence retrieval, explanation,
and verification in order. Follow-ups retain the recent history and known symbols
sent by the Next.js route.

**Honest attribution.** Each agent entry is built from what actually ran: status
(`completed | skipped | failed | insufficient_evidence`), a summary of its
observable output, the source markers it used, and `duration_ms` measured around
the real call (`null` when skipped). A throwing agent becomes `failed` with a
sanitized reason — its findings are never invented, and downstream agents that
depended on it are marked skipped. Progress events are emitted when an agent
really starts/finishes, never from timers.

**Grounding & verification.** Sources keep article ids, URLs (when the corpus has
them), providers and dates and get citation markers (`[1]`, `[M1]` for market
data). Market data is labelled `live | delayed | cached | simulated |
unavailable`. The Verification Agent removes statements with unknown citations,
figures or dates absent from the evidence, causal claims without a cited article,
price/sentiment directions that contradict the structured data, "live" claims
about non-live data, and anything that reads as personalized advice; it reports
each removal as an issue (`verification.status = failed`) and warns about
correlation-vs-causation wording and stale/simulated data. With no usable
evidence the LLM is not called at all and the answer says so.

**LLM fallback.** The Financial Explanation Agent calls Groq's Chat Completions API
(`GROQ_API_KEY`, `CHAT_LLM_MODEL`). If the key is missing or the call fails
or times out it produces a deterministic, citation-bearing, evidence-only answer
and the response is labelled `generation.mode = "fallback"` (badge in the UI and a
note in the answer). Secrets and raw provider errors are never returned.

### Response contract (`POST /api/chat`)

Request: `{ "message": "...", "conversation_id"?: "...", "history"?: [{role, content, tickers?}], "stream"?: true }`.
With `stream: true` the body is NDJSON: `{"type":"progress",...}` events, then one
`{"type":"result","data":<ChatResponse>}`. Without it, `ChatResponse` is returned
as plain JSON:

```json
{
  "conversation_id": "…",
  "answer": "Final verified answer … + Data notes",
  "agents": [{ "agent_id": "market_context", "agent_name": "Market Context Agent",
               "description": "…", "status": "completed", "summary": "Actual work performed",
               "sources": ["M1"], "duration_ms": 42 }],
  "sources": [{ "ref": "1", "type": "article", "title": "…", "url": null, "provider": "MarketWire",
                "article_id": "n001", "published_at": "2026-08-12", "ticker": "TCS", "cited": true }],
  "data_freshness": { "generated_at": "…", "market": [{ "symbol": "TCS", "data_type": "simulated", "provider": "simulated",
                      "as_of": "…", "age_seconds": 120, "note": "…" }], "news": { "article_count": 2,
                      "newest_article_date": "…", "oldest_article_date": "…", "note": "…" } },
  "verification": { "status": "passed | passed_with_warnings | failed | not_run", "issues": [] },
  "generation": { "mode": "llm | fallback | none", "provider": null, "model": null, "reason": null },
  "tickers": ["TCS"]
}
```

All responses are validated with `chatResponseSchema` before they leave the server.

### Setup

1. Follow NLP_SETUP.md to run the Python NLP service (`NLP_SERVICE_URL`), and the
   usual `npm install`, `npm run prisma:migrate`, `npm run dev`.
2. Optional: set `GROQ_API_KEY` (and `CHAT_LLM_MODEL`) in `.env` for LLM
   answers; without it the chatbot works in labelled fallback mode.
3. Open `/chat`. Yahoo Finance article links and publication dates are included
   when the provider returns them.
4. Tests: `npm run typecheck`; the Python service can be checked with
   `python -m compileall app` from `nlp-service`.

### Hosted deployment

The included `vercel.json` configures the Next.js app for Vercel, while
`render.yaml` configures the Python NLP service for Render. GitHub Pages is
not suitable because this project needs server-side API routes, PostgreSQL,
and FastAPI.

1. Push the project to a GitHub repository and import it into Vercel.
2. Create a Neon PostgreSQL database and set `DATABASE_URL` in Vercel.
3. Deploy `render.yaml` from the same repository and copy the Render service
   URL into Vercel as `NLP_SERVICE_URL`.
4. Set `NEXT_PUBLIC_APP_URL` to the Vercel HTTPS URL.
5. Set `GROQ_API_KEY` as a secret in Vercel and Render, then run
   `npx prisma migrate deploy` once against the Neon database.

Never commit `.env`; rotate any API key that has previously been exposed in a
local environment before publishing the project.

### What is real and what is simulated (read before a demo)

| Part | Default | How the chatbot labels it |
|---|---|---|
| Market prices / history | **Yahoo Finance via `yfinance` by default** (`MARKET_DATA_PROVIDER=yfinance`, no key); exchange delays or rate limits may apply. `simulated` is an explicit demo-only option. | Provider, timestamp, and `live` / `delayed` / `cached` / `unavailable` state are reported; Yahoo quotes are not guaranteed real-time. |
| News | **Yahoo Finance ticker news by default** via `yfinance`; a custom corpus can be explicitly selected with `NEWS_CORPUS_PATH`. Yahoo may return headlines without article body summaries. | `data_freshness.news.corpus` = `live` / `custom` / `sample` / `unknown`; publisher, publication date, and URL are preserved when supplied. |
| NLP model training | Bundled sample labels are not loaded by default. | Sentiment uses FinBERT if available or a disclosed lexicon fallback; categories use keyword rules. Optional trained classifiers require explicitly configured licensed datasets. |
| LLM answer | Needs `GROQ_API_KEY`; otherwise a deterministic evidence-only fallback. | `generation.mode` = `llm` / `fallback` / `none`. |

Rate limiting: `/api/chat` allows `CHAT_RATE_LIMIT_PER_MINUTE` (default 20) requests per client per minute (in-memory, per process).

Known limits: Yahoo Finance data can be delayed, throttled, or unavailable and
is not an official real-time feed; bundled labeled NLP data is only for
tests/evaluation unless explicitly configured; ticker detection is rule-based (uppercase symbols, `$TICKER`,
watchlist symbols, a few company names); conversation history is kept in the
browser (localStorage) and sent with each request rather than stored in the database.

## Market Intelligence checkpoint

The dashboard is driven by watchlist observations and the deterministic
attention engine. It does not display portfolio value, invested value, or P&L
unless a real portfolio model exists (the current product does not). The
Market snapshot reports tracked stocks, meaningful changes, gainers,
decliners, unchanged instruments, stale/unavailable data, biggest mover, and
the latest observed timestamp.

Market View is available on the dashboard with line, area, bar, candlestick,
Heikin-Ashi, Renko, and Market Map modes. Candles use provider OHLCV data;
Heikin-Ashi and Renko are pure derived views. Simulated mode clearly reports
DEMO DATA and generates deterministic OHLCV history. Twelve Data history uses
its `time_series` endpoint and returns an explicit unavailable state when the
provider, key, rate limit, or network is unavailable.

The history endpoint is `GET /api/market/history?symbol=NVDA&range=1M` and is
ownership-scoped to the current user's watchlists. The existing `/api/attention`
endpoint remains the source of truth for “Since your last visit,” freshness,
and movement classification.

## Project overview

PulseWatch is a smart market watchlist, extended for this project with
an NLP-powered financial intelligence layer (see NLP_ARCHITECTURE.md).
It aims to answer: **"What meaningfully changed since I last checked, and
what deserves my attention now?"** — rather than making the user scan
every tracked instrument manually.

**The sections below describe PulseWatch's original development history**
(watchlist CRUD, market data, the attention engine, "since your
last visit," and a UI pass), preserved as-is beneath the NLP
extension described above. I05 is a
scoped accessibility/polish pass on top of an I04 UI that already
matched most of the final brief: a keyboard focus trap and screen-
reader announcements (`aria-live`/`role="alert"`) on the confirm
dialog and loading/error states, a visible focus ring on every
interactive element, a few missing hover states, and tighter mobile
layout for the confirm dialog and dashboard stat grid. See PROGRESS.md
for exact status (including the Iteration 3→4 numbering note and the
full I05 changelist) and DECISIONS.md for why things were built this
way.

## Problem being solved

Manually scanning a watchlist for what matters doesn't scale. PulseWatch
compares the current market state against what the user last saw and
surfaces only meaningful changes, with an explainable reason for each.

## Current features

- Project scaffolding: Next.js (App Router) + TypeScript, strict mode.
- Database schema modeling users, watchlists, instruments, append-only
  price-observation history, and per-user last-seen baselines (see
  `prisma/schema.prisma`).
- `GET /api/health` — reports app liveness and database connectivity.
- Validated environment configuration (fails fast on missing/invalid
  config).
- **Watchlist CRUD** — create, rename, delete watchlists.
- **Watchlist items** — add/remove symbols on a watchlist, with duplicate
  prevention (checked in the service layer and enforced by a database
  unique constraint).
- **Market data** — a provider abstraction (`MarketDataProvider`) behind
a factory, selected by `MARKET_DATA_PROVIDER`. Three implementations:
  - `yfinance` (**default**) — real Yahoo Finance quotes and history via
    the Python `yfinance` library; no key required, but data may be
    delayed or throttled.
  - `twelvedata` — real quotes from Twelve Data, rate-limited and
    timeout-bound.
  - `simulated` — explicit demo-only provider; never used unless selected.

  Both go through the same pipeline: automatic fallback to the last
  known price (marked stale) or an explicit "unavailable" state, never a
  crash or a fabricated price, with every successful read persisted as
  history.
- **Attention engine** — a deterministic, explainable comparison of the
  current price against what the user last saw, producing one of NEW /
  UNCHANGED / CHANGED / SIGNIFICANT / STALE / UNAVAILABLE with a
  human-readable reason.
- **API**: `/api/watchlists`, `/api/attention`, and nested routes — see
  ARCHITECTURE.md for the full list. Consistent JSON error shape,
  zod-validated input.
- **UI** — a premium dark, Groww-inspired fintech "market-intelligence
  command center" look (near-black surfaces, a single Groww-inspired
  green accent, glass panels, editorial serif headings, restrained
  status colors, calm staggered motion) with PulseWatch's own layout,
  not a Groww clone. See ARCHITECTURE.md → "UI layer (Iteration 6)" and
  DECISIONS.md #24:
  - `AppHeader` — persistent glass-pill brand bar on every page, now
    showing real market-data freshness ("Updated N min ago") and a
    manual refresh control, both driven by the existing attention feed.
  - Watchlists dashboard (`/`) — an editorial page intro ("Here's what
    changed."), a 4-metric strip (watchlists, tracked stocks, meaningful
    changes, data freshness), the "since your last visit" hero panel,
    watchlist management, and a first-run empty state when there are no
    watchlists yet.
  - **"Since your last visit"** is the visual centerpiece: a glass hero
    panel with a dynamic "N meaningful changes" count, ticker + company
    name, current price, percent change, and an explicit
    `previous → current` comparison on every notable card
    (SIGNIFICANT/CHANGED/NEW), with quieter statuses collapsed by
    default.
  - Watchlist detail (`/watchlists/[id]`) — "What's moving" (the same
    attention feed, scoped to one watchlist) and per-symbol rows showing
    ticker, company name, price, and freshness from `/api/attention`.
  - `ConfirmDialog` — an in-app confirm modal for destructive actions
    (delete watchlist, remove symbol), replacing the earlier
    `window.confirm`/`alert` calls.
  - Real loading/empty/error states throughout, no hardcoded/fake data
      in the live market/news views; see "Simulated provider" for the
      explicit demo-only price option.
  - Responsive down to narrow/mobile widths; entrance motion respects
    `prefers-reduced-motion`.
  - **I06 refinement**: SIGNIFICANT now colours by movement direction
    (green for a gain, red for a drop) instead of defaulting to red;
    desktop content width widened to 1120px; "Since your last visit"
    now renders ahead of the statistics strip on the dashboard; mobile
    overflow/cramping hardened. See DECISIONS.md #25/#26.
  - **First-load intro + auth polish (A08)**: a full-screen black
    typewriter splash ("PulseWatch...", ~1.7-1.8s, `prefers-reduced-motion`
    aware, runs once per real page load) via `PulseWatchIntro`, before
    the app content cross-fades in. The `/login`/`/signup` purple glow
    loops slowly around the full boundary of the screen (all four
    corners) instead of sitting static in a corner or staying confined
    to one side, and no longer fades out near the edges (a page-wide
    vignette was quietly overpainting it there). The background waves
    are dimmed but still visibly moving (a duplicate wave layer was
    removed, the remaining one was switched from a Framer Motion
    transform that silently didn't animate on an SVG `<path>` to
    native SMIL, and the purple layers were lightened to a pale violet
    so they read clearly rather than dark/muddy) so the auth form
    stays the clear focal point. See PROJECT_SPEC.md → "A08 first-load
    and auth polish" and DECISIONS.md #38-43, #45.
  - **Real-time updates (A08)**: `useAttention` (the shared hook behind
    the attention feed, header freshness readout, and watchlist rows)
    silently re-polls every 25 seconds — no loading-state flash, no
    surfaced errors on a transient failure, paused while the tab is
    hidden — so prices and "since your last visit" state stay current
    without a manual refresh. Plain `setInterval`, no WebSocket/SSE
    server, no new dependency. See DECISIONS.md #44.
  - Synthetic portfolio holdings/P&L are not shown. Watchlists do not
    contain ownership quantities or buy prices, so the app does not
    invent portfolio values.
- **Anonymous per-browser identity** — a placeholder for real auth (not
  yet built) so watchlist and attention data can be scoped per user
  today. See DECISIONS.md #7.
- Test, lint, and typecheck tooling wired up (see PROGRESS.md → KNOWN
  LIMITATIONS for what could not be re-verified in this sandbox).

See PROGRESS.md → REMAINING WORK for what's next (real auth, automated
tests for the new modules, live verification).

## Technology stack

- **Frontend/Backend**: Next.js 14 (App Router), React 18, TypeScript
  (strict mode)
- **Database**: PostgreSQL
- **ORM**: Prisma
- **Validation**: zod
- **Testing**: Vitest
- **Linting**: ESLint (`next/core-web-vitals`)
- **Styling**: plain hand-written CSS (`src/app/globals.css`) — no
  framework, see DECISIONS.md

## Project structure

```
pulsewatch/
├── src/
│   ├── app/
│   │   ├── page.tsx                    # Watchlists dashboard route
│   │   ├── watchlists/[id]/page.tsx    # Watchlist detail route
│   │   ├── components/                 # Client components (UI + fetch calls)
│   │   │   ├── AppHeader.tsx
│   │   │   ├── AttentionSection.tsx
│   │   │   ├── ConfirmDialog.tsx
│   │   │   ├── WatchlistsDashboard.tsx
│   │   │   └── WatchlistDetail.tsx
│   │   ├── hooks/useAttention.ts       # Shared fetch/loading/error hook for the attention feed
│   │   ├── globals.css                 # Design system (Groww-inspired fintech theme)
│   │   └── api/
│   │       ├── health/route.ts
│   │       ├── attention/route.ts
│   │       └── watchlists/             # Watchlist REST API (see ARCHITECTURE.md)
│   ├── lib/
│   │   ├── api-client.ts               # Client-safe fetch wrapper for the API
│   │   └── format.ts                   # Shared price/percent/freshness formatting
│   ├── types/                          # Shared DTOs (client + server safe)
│   │   ├── watchlist.ts
│   │   └── attention.ts
│   └── server/
│       ├── db/prisma.ts                # Prisma client singleton
│       ├── lib/
│       │   ├── env.ts                  # Validated environment config
│       │   ├── current-user.ts         # Anonymous-user placeholder for auth
│       │   └── api-response.ts         # Error → HTTP response mapping
│       └── modules/
│           ├── watchlist/              # CRUD service, validation, errors
│           ├── market/                 # Provider factory, yfinance + Twelve Data + demo provider, rate limiter, source-aware fallback
│           └── attention/              # Last-seen baselines, comparison engine
├── prisma/schema.prisma         # Database schema (+ LastSeenState)
├── tests/unit/                  # Vitest unit tests
├── .env.example
└── package.json
```

See ARCHITECTURE.md for details and rationale.

## Setup instructions

Requires Node.js 20+ and a running PostgreSQL instance.

```bash
npm install
cp .env.example .env    # then edit DATABASE_URL to point at your database
npx prisma generate
npx prisma migrate dev  # applies the schema to your database
./start.sh              # starts Next.js and the Python NLP service
```

On the first run, `start.sh` installs missing Node.js/Python dependencies
and generates the Prisma client. Use `./start.sh --no-nlp` to run only the
Next.js app. The PostgreSQL database must be running and migrated before
starting; the launcher does not apply database migrations automatically.

## Environment variables

See `.env.example`. Required:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string used by Prisma |
| `NEXT_PUBLIC_APP_URL` | Base URL of the app (defaults to `http://localhost:3000`) |

Optional, with defaults (market data / attention):

| Variable | Default | Description |
|---|---|---|
| `MARKET_DATA_PROVIDER` | `yfinance` | `yfinance` (Yahoo Finance via Python), `simulated` (demo only), or `twelvedata` |
| `TWELVE_DATA_API_KEY` | *(unset)* | Only used when `MARKET_DATA_PROVIDER=twelvedata`. Get a free key at twelvedata.com. Without it, every quote falls back to stale/unavailable |
| `MARKET_DATA_TIMEOUT_MS` | `5000` | Provider request timeout |
| `MARKET_DATA_RATE_LIMIT_PER_MINUTE` | `7` | Shared in-memory quote and history request limit per minute |
| `ATTENTION_CHANGED_PCT` | `0.5` | Minimum % move to classify CHANGED |
| `ATTENTION_SIGNIFICANT_PCT` | `3` | Minimum % move to classify SIGNIFICANT (must be ≥ `ATTENTION_CHANGED_PCT`) |

Optional, chatbot / NLP (see `.env.example` for comments):

| Variable | Default | Description |
|---|---|---|
| `NLP_SERVICE_URL` | `http://localhost:8000` | Python NLP service (run per NLP_SETUP.md) |
| `NLP_SERVICE_TIMEOUT_MS` | `8000` | Timeout per NLP call |
| `NLP_FEATURE_ENABLED` | `true` | `false` disables all NLP features |
| `GROQ_API_KEY` | *(unset)* | Enables Groq LLM answers; add a valid key to local `.env`, never commit it |
| `CHAT_LLM_MODEL` | `llama-3.3-70b-versatile` | Groq model for the Financial Explanation Agent |
| `CHAT_LLM_TIMEOUT_MS` | `25000` | LLM timeout before the labelled fallback |
| `CHAT_RATE_LIMIT_PER_MINUTE` | `20` | Per-client `/api/chat` limit |

`src/server/lib/env.ts` validates all of these at runtime and throws a
clear error if they're missing or malformed.

## Demo flow

The default configuration uses Yahoo Finance (`MARKET_DATA_PROVIDER=yfinance`)
and needs no market-data API key. Configure `GROQ_API_KEY` to enable generated
chat answers:

```bash
npm install
cp .env.example .env    # set DATABASE_URL and GROQ_API_KEY if you want LLM answers
npx prisma generate
npx prisma migrate dev
npm run dev
```

1. Open `http://localhost:3000` — first run shows the empty-state card.
2. Create a watchlist and add symbols supported by Yahoo Finance, such as
   `AAPL`, `TCS`, or `RELIANCE`.
3. Revisit the dashboard or watchlist page. Quotes and historical bars are
   fetched from Yahoo Finance; data may be delayed or unavailable.

### Simulated provider

`src/server/modules/market/providers/simulated.provider.ts` implements
the same `MarketDataProvider` interface as the real Twelve Data
provider and is selected by the same factory
(`src/server/modules/market/provider-factory.ts`) — so it goes through
the identical pipeline (rate limiter, timeout, `PriceObservation`
persistence, stale/unavailable fallback) as a real provider. No
component ever hardcodes fake prices; every price the UI shows,
simulated or real, came from `/api/attention` or `/api/watchlists/**`
by way of this same provider abstraction.

It is explicitly **development/demo only** — see the file's header
comment. Yahoo Finance via Python `yfinance` is the default; select
`MARKET_DATA_PROVIDER=simulated` only when intentionally demonstrating
synthetic prices.

## Database setup

1. Have a PostgreSQL instance available (locally, Docker, or hosted).
2. Set `DATABASE_URL` in `.env` accordingly.
3. Run `npx prisma generate` to generate the typed client.
4. Run `npx prisma migrate dev` to create/update the schema — this
   applies the repository migrations, including password hashes and
   revocable sessions for account authentication.

Yahoo Finance (`yfinance`) is the default real-data provider and needs no
API key. To use Twelve Data instead, set `MARKET_DATA_PROVIDER=twelvedata`
and configure `TWELVE_DATA_API_KEY`.

## How to run locally

```bash
npm run dev
```

Visit `http://localhost:3000` for the watchlists dashboard. Check
`http://localhost:3000/api/health` to confirm the app and database are
reachable.

## How to run tests

```bash
npm test
```

## How to build

```bash
npm run build
npm start
```

Also available: `npm run lint`, `npm run typecheck`.

## Known limitations

- **Authentication is local email/password.** Passwords are stored as
  salted scrypt hashes and requests require an unexpired server-side
  session. Password reset, email verification, and federated sign-in are
  not implemented; use a managed identity provider for public production
  deployments. New passwords must be at least 4 characters. Existing
  demo email records can set a password by signing up with that same email.
- **Simulated provider is demo-only.** Its prices are synthetic; see
  "Simulated provider" above. The default `yfinance` provider and optional
  Twelve Data provider use external market data.
- **No automated UI/component or browser tests.** `tests/unit/` covers
  configuration, market-provider boundaries and labels, watchlist
  validation, chat orchestration, evidence verification, streaming,
  rate limiting, and the NLP client. The database-backed watchlist
  service and visual components still need browser/integration coverage.
- **External credentials are not covered by unit tests.** Groq generation
  and Twelve Data requests require credentials and must be tested with
  valid keys; Yahoo Finance availability depends on the upstream service.
