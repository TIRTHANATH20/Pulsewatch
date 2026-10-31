import { getEnv } from "@/server/lib/env";
import { getMarketDataProvider } from "./provider-factory";
import { getMarketDataRateLimiter } from "./rate-limiter";
import {
  recordObservation,
  getLatestObservation,
  getRecentObservations,
  backfillInstrumentMetadata,
} from "./repository";
import { quoteCache, quoteCacheKey } from "./quote-cache";
import type { HistoricalBar, HistoryRange, NormalizedQuote, QuoteOutcome } from "./types";

// The yfinance provider talks to our own local Python service, not to a keyed
// API with a 7/minute quota, so the Twelve Data-sized default budget (and a 5s
// timeout that is shorter than the Python service's own 15s Yahoo timeout)
// only caused spurious STALE / "history unavailable" results.
const YFINANCE_MIN_REQUESTS_PER_MINUTE = 60;
const YFINANCE_MIN_QUOTE_TIMEOUT_MS = 12_000;
const YFINANCE_MIN_HISTORY_TIMEOUT_MS = 20_000;

function quoteBudget(providerName: string, configured: number): number {
  return providerName === "yfinance" ? Math.max(configured, YFINANCE_MIN_REQUESTS_PER_MINUTE) : configured;
}

function quoteTimeoutMs(providerName: string, configured: number): number {
  return providerName === "yfinance" ? Math.max(configured, YFINANCE_MIN_QUOTE_TIMEOUT_MS) : configured;
}

function historyTimeoutMs(providerName: string, configured: number): number {
  return providerName === "yfinance" ? Math.max(configured, YFINANCE_MIN_HISTORY_TIMEOUT_MS) : configured;
}

export interface InstrumentRef {
  id: string;
  symbol: string;
}

export interface QuoteRequestOptions {
  // Reuse a successful quote for this symbol fetched at most this long ago
  // instead of calling the provider again (see quote-cache.ts). Defaults to 0:
  // always ask the provider, which is what every pre-existing caller expects.
  maxAgeMs?: number;
}

function freshOutcome(quote: NormalizedQuote): QuoteOutcome {
  return {
    status: "fresh",
    price: quote.price,
    observedAt: quote.observedAt,
    currency: quote.currency,
    volume: quote.volume,
    avgVolume: quote.avgVolume,
    quoteTime: quote.quoteTime,
    marketOpen: quote.marketOpen,
    previousClose: quote.previousClose,
  };
}

// The single entry point the rest of the app (the attention module) uses
// to get a price for an instrument. Folds together: rate limiting,
// request timeout, provider failure handling, PriceObservation
// persistence, and stale/unavailable fallback — callers only ever see a
// `QuoteOutcome`, never a raw provider exception.
//
// PROJECT_SPEC.md's reliability requirement: a provider failure must
// never corrupt stored data or crash the app, and the last known good
// data should still be servable, marked as stale. This function is where
// that requirement is actually implemented.
export async function getQuoteForInstrument(
  instrument: InstrumentRef,
  options: QuoteRequestOptions = {},
): Promise<QuoteOutcome> {
  const env = getEnv();
  const provider = getMarketDataProvider();
  const cacheKey = quoteCacheKey(provider.name, instrument.symbol);

  // A recent successful quote for this symbol is reused without touching the
  // provider, the rate limiter or the database (it was already persisted when
  // it was first fetched).
  const cached = quoteCache.get(cacheKey, options.maxAgeMs ?? 0);
  if (cached) {
    return freshOutcome(cached);
  }

  const limiter = getMarketDataRateLimiter(
    quoteBudget(provider.name, env.MARKET_DATA_RATE_LIMIT_PER_MINUTE),
    "quotes",
  );

  if (!limiter.tryAcquire()) {
    return fallbackOrUnavailable(
      instrument.id,
      "Market data rate limit reached for this minute",
      provider.name,
    );
  }

  const timeoutMs = quoteTimeoutMs(provider.name, env.MARKET_DATA_TIMEOUT_MS);
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const quote = await provider.fetchQuote(instrument.symbol, controller.signal);
    quoteCache.set(cacheKey, quote);

    // Persistence and metadata backfill happen best-effort, after the
    // successful read: if either write fails (e.g. a transient DB
    // hiccup), the user should still get the fresh price they were
    // waiting on rather than the whole request failing — an unpersisted
    // observation just means the next successful read won't have this
    // one specific point in its history, which is a much smaller problem
    // than serving no price at all.
    try {
      await recordObservation(instrument.id, quote, provider.name);
      await backfillInstrumentMetadata(instrument.id, {
        name: quote.name,
        exchange: quote.exchange,
      });
    } catch {
      // Deliberately swallowed — see comment above. Persistence failure
      // must not turn a successful market-data read into a user-facing
      // error.
    }

    return freshOutcome(quote);
  } catch (err) {
    const reason = describeError(err, timeoutMs);
    return fallbackOrUnavailable(instrument.id, reason, provider.name);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

// Chat can ask about symbols that are not in a watchlist. Keep those direct
// provider reads inside the same request budget as watchlist quotes.
export async function getQuoteForSymbol(symbol: string): Promise<QuoteOutcome> {
  const env = getEnv();
  const provider = getMarketDataProvider();
  const limiter = getMarketDataRateLimiter(
    quoteBudget(provider.name, env.MARKET_DATA_RATE_LIMIT_PER_MINUTE),
    "quotes",
  );

  if (!limiter.tryAcquire()) {
    return {
      status: "unavailable",
      reason: "Market data rate limit reached for this minute",
    };
  }

  const timeoutMs = quoteTimeoutMs(provider.name, env.MARKET_DATA_TIMEOUT_MS);
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const quote = await provider.fetchQuote(symbol, controller.signal);
    return {
      status: "fresh",
      price: quote.price,
      observedAt: quote.observedAt,
      currency: quote.currency,
      volume: quote.volume,
      avgVolume: quote.avgVolume,
      quoteTime: quote.quoteTime,
      marketOpen: quote.marketOpen,
    };
  } catch (err) {
    return {
      status: "unavailable",
      reason: describeError(err, timeoutMs),
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

// Real, persisted price history for an instrument — the source for the
// UI's sparklines. Ascending order (oldest first). Never fabricated: this
// is exactly what `market/repository.ts` recorded from past reads by
// the currently selected provider, including this request's observation.
export async function getRecentPriceHistory(
  instrumentId: string,
  limit = 20,
): Promise<number[]> {
  try {
    const rows = await getRecentObservations(
      instrumentId,
      limit,
      getMarketDataProvider().name,
    );
    return rows.map((row) => Number(row.price));
  } catch {
    // Same "never fail the whole response over a secondary read" rule as
    // the rest of this module — a sparkline is presentational, not a
    // required field.
    return [];
  }
}

// --- Chart history ---------------------------------------------------------
// History used to hit the provider on every click with no caching, no retry and
// no fallback, so any hiccup (or the shared rate limit) showed "history is
// unavailable". Now: successful results are cached per (provider, symbol,
// range), concurrent identical requests share one provider call, one transient
// failure is retried, and if the provider still fails the last good bars are
// served and labelled "stale" instead of an empty chart.
interface HistoryEntry {
  bars: HistoricalBar[];
  storedAt: number;
}

export type HistoryResult = {
  bars: HistoricalBar[];
  source: string;
  status: "fresh" | "stale" | "unavailable";
};

const historyCache = new Map<string, HistoryEntry>();
const historyInFlight = new Map<string, Promise<HistoryResult>>();
const HISTORY_CACHE_MAX_ENTRIES = 200;
const HISTORY_TTL_MS: Record<HistoryRange, number> = {
  "1D": 60_000,
  "1W": 5 * 60_000,
  "1M": 15 * 60_000,
  "3M": 15 * 60_000,
  "1Y": 15 * 60_000,
};

export function clearHistoryCache(): void {
  historyCache.clear();
  historyInFlight.clear();
}

export async function getHistoricalBars(instrument: InstrumentRef, range: HistoryRange): Promise<HistoryResult> {
  const provider = getMarketDataProvider();
  const key = `${provider.name}:${instrument.symbol.trim().toUpperCase()}:${range}`;

  const cached = historyCache.get(key);
  if (cached && Date.now() - cached.storedAt < HISTORY_TTL_MS[range]) {
    return { bars: cached.bars, source: provider.name, status: "fresh" };
  }

  const pending = historyInFlight.get(key);
  if (pending) return pending;

  const run = fetchHistoryUncached(instrument, range, key, cached);
  historyInFlight.set(key, run);
  try {
    return await run;
  } finally {
    historyInFlight.delete(key);
  }
}

async function fetchHistoryUncached(
  instrument: InstrumentRef,
  range: HistoryRange,
  key: string,
  previous: HistoryEntry | undefined,
): Promise<HistoryResult> {
  const env = getEnv();
  const provider = getMarketDataProvider();
  const staleOrUnavailable = (): HistoryResult =>
    previous && previous.bars.length
      ? { bars: previous.bars, source: provider.name, status: "stale" }
      : { bars: [], source: provider.name, status: "unavailable" };

  const limiter = getMarketDataRateLimiter(
    quoteBudget(provider.name, env.MARKET_DATA_RATE_LIMIT_PER_MINUTE),
    "history",
  );
  if (!limiter.tryAcquire()) return staleOrUnavailable();

  const timeoutMs = historyTimeoutMs(provider.name, env.MARKET_DATA_TIMEOUT_MS);
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const bars = await provider.fetchHistory(instrument.symbol, range, controller.signal);
      if (bars.length) {
        historyCache.delete(key);
        historyCache.set(key, { bars, storedAt: Date.now() });
        if (historyCache.size > HISTORY_CACHE_MAX_ENTRIES) {
          const oldest = historyCache.keys().next().value;
          if (oldest !== undefined) historyCache.delete(oldest);
        }
      }
      return { bars, source: provider.name, status: "fresh" };
    } catch {
      // Retry once after a short pause (Yahoo fails intermittently); then fall back.
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 400));
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
  return staleOrUnavailable();
}

function describeError(err: unknown, timeoutMs: number): string {
  if (err instanceof DOMException && err.name === "AbortError") {
    return `Market data request timed out after ${timeoutMs}ms`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return "Unknown market data provider error";
}

async function fallbackOrUnavailable(
  instrumentId: string,
  reason: string,
  source: string,
): Promise<QuoteOutcome> {
  let last: Awaited<ReturnType<typeof getLatestObservation>>;
  try {
    last = await getLatestObservation(instrumentId, source);
  } catch {
    // The database itself is unreachable — this instrument has no
    // servable price at all right now, but that must not throw and take
    // the rest of the /api/attention response down with it (see
    // attention/service.ts, which also wraps each instrument
    // independently as a second layer of the same guarantee).
    return { status: "unavailable", reason };
  }

  if (!last) {
    return { status: "unavailable", reason };
  }

  return {
    status: "stale",
    price: Number(last.price),
    observedAt: last.observedAt,
    reason,
  };
}
