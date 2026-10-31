# Market data module

Status: implemented (Iteration 3).

## Responsibility

Fetches current prices from an external market-data provider, persists
every successful read as an append-only `PriceObservation` row, and
degrades gracefully when the provider fails or is rate-limited — per
PROJECT_SPEC.md's reliability requirement, a provider failure must never
corrupt stored data or crash the app, and the last known good price
should still be servable, explicitly marked as stale.

## Entry point

`getQuoteForInstrument({ id, symbol })` (`service.ts`) is the only
function other modules should call. It returns a `QuoteOutcome`:

- `{ status: "fresh", price, observedAt }` — a live read just succeeded
  and was persisted.
- `{ status: "stale", price, observedAt, reason }` — the live read
  failed (timeout, rate limit, provider error); `price`/`observedAt` come
  from the most recent stored `PriceObservation` instead. `reason`
  explains why the live read failed, for display/logging.
- `{ status: "unavailable", reason }` — the live read failed *and* no
  `PriceObservation` exists yet for this instrument, so there is nothing
  to fall back to.

Callers never see a raw provider exception — every failure mode is
folded into one of the three outcomes above.

## Structure

- `types.ts` — `NormalizedQuote`, `MarketDataProvider` interface,
  `QuoteOutcome`. Provider-agnostic; every provider implementation
  normalizes into `NormalizedQuote` at its own boundary.
- `providers/twelve-data.provider.ts` — calls Twelve Data's `/quote`
  endpoint; handles Twelve Data's quirk of returning HTTP 200 with
  `{ status: "error" }` in the body for symbol/key/rate-limit failures
  instead of a non-2xx status.
- `providers/yfinance.provider.ts` — calls the Python service's market
  endpoints, which retrieve quotes and historical bars with the
  `yfinance` library. Known NSE symbols are mapped to Yahoo's `.NS`
  suffix; other symbols can include an explicit exchange suffix (for
  example, `.NS` or `.BO`). Yahoo data availability, delays, and
  throttling are outside the library's control.
- `providers/simulated.provider.ts` — a dependency-free, in-memory
  provider (no network I/O) implementing the same `MarketDataProvider`
  interface for explicit demonstrations and tests. It is not the default;
  select it with `MARKET_DATA_PROVIDER=simulated`. **As of Iteration 7**,
  it ships a curated table of 15
  recognizable symbols (RELIANCE, TCS, INFY, HDFCBANK, ICICIBANK, SBIN,
  ITC, BHARTIARTL, LT, MARUTI on NSE; AAPL, MSFT, NVDA, TSLA, AMZN on
  NASDAQ), each with a realistic starting price, company name, baseline
  volume, and a movement profile (`trend-up` / `trend-down` / `stable` /
  `volatile`) that biases how often and how far its price moves on each
  call. Any other symbol still falls back to the original hash-derived
  starting price and a balanced "mixed" profile — see DECISIONS.md #28.
- `provider-factory.ts` — resolves a provider from `MARKET_DATA_PROVIDER`
  (`"simulated"`, `"twelvedata"`, or `"yfinance"`). Adding a provider is a
  new case here, not a change to `service.ts`.
- `rate-limiter.ts` — an in-memory sliding-window limiter
  (`MARKET_DATA_RATE_LIMIT_PER_MINUTE`, default 7/min). Per-process, not distributed — see
  DECISIONS.md for why that's an accepted trade-off at this scope.
- `repository.ts` — `PriceObservation` persistence
  (`recordObservation`, `getLatestObservation`), plus
  `backfillInstrumentMetadata`, which fills in the placeholder
  `Instrument.name`/`exchange` values (`name = symbol`,
  `exchange = "UNKNOWN"`) the watchlist module creates when a symbol is
  first added (see DECISIONS.md #10), without overwriting a value
  that's already been resolved.
- `service.ts` — orchestrates the above: rate limit check → timeout-bound
  provider call → persist + backfill on success → fallback to the latest
  stored observation from the same provider (or "unavailable") on failure.
  Stored observations and sparklines from a different provider are not
  mixed in after switching providers.
- `errors.ts` — `ProviderRequestError` (thrown by both providers on any
  request failure, including a missing API key or a non-numeric price)
  is caught inside `service.ts` in normal operation. `ProviderTimeoutError`
  and `RateLimitExceededError` are declared for future use by providers
  that want a more specific error type than `ProviderRequestError`, but
  nothing currently throws them — today's timeout/rate-limit handling
  lives in `service.ts` itself (via `AbortController` and
  `SlidingWindowRateLimiter`), not inside a provider.

## Configuration

See `.env.example` / `src/server/lib/env.ts`:
`MARKET_DATA_PROVIDER`, `TWELVE_DATA_API_KEY`,
`MARKET_DATA_TIMEOUT_MS`, and `MARKET_DATA_RATE_LIMIT_PER_MINUTE`.

## Known limitations

- Rate limiting is per-process/in-memory — see `rate-limiter.ts` and
  DECISIONS.md.
- `TWELVE_DATA_API_KEY` unset is handled gracefully (every quote falls
  back to `stale`/`unavailable`) but Twelve Data has not been exercised
  against a live account in this sandbox — see PROGRESS.md → Known
  Issues.
- `yfinance` is an unofficial Python client for Yahoo Finance; Yahoo may
  delay or throttle its data, and availability is not guaranteed.
