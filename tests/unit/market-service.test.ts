import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchQuote: vi.fn(),
  fetchHistory: vi.fn(),
  tryAcquire: vi.fn(),
}));

vi.mock("@/server/lib/env", () => ({
  getEnv: () => ({
    MARKET_DATA_TIMEOUT_MS: 1000,
    MARKET_DATA_RATE_LIMIT_PER_MINUTE: 7,
  }),
}));
vi.mock("@/server/modules/market/provider-factory", () => ({
  getMarketDataProvider: () => ({
    name: "test-provider",
    fetchQuote: mocks.fetchQuote,
    fetchHistory: mocks.fetchHistory,
  }),
}));
vi.mock("@/server/modules/market/rate-limiter", () => ({
  getMarketDataRateLimiter: () => ({ tryAcquire: mocks.tryAcquire }),
}));
vi.mock("@/server/modules/market/repository", () => ({
  recordObservation: vi.fn(),
  getLatestObservation: vi.fn(),
  getRecentObservations: vi.fn(),
  backfillInstrumentMetadata: vi.fn(),
}));

import { getHistoricalBars, getQuoteForInstrument, getQuoteForSymbol } from "@/server/modules/market/service";
import { quoteCache } from "@/server/modules/market/quote-cache";

describe("market provider request limits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    quoteCache.clear();
    mocks.tryAcquire.mockReturnValue(true);
    mocks.fetchQuote.mockResolvedValue({
      symbol: "TCS",
      price: 3500,
      observedAt: new Date("2026-10-24T10:00:00.000Z"),
    });
    mocks.fetchHistory.mockResolvedValue([]);
  });

  it("applies the shared request budget to direct chatbot quotes", async () => {
    mocks.tryAcquire.mockReturnValue(false);

    const result = await getQuoteForSymbol("TCS");

    expect(result).toMatchObject({ status: "unavailable", reason: expect.stringMatching(/rate limit/i) });
    expect(mocks.fetchQuote).not.toHaveBeenCalled();
  });

  it("applies the shared request budget to historical-data requests", async () => {
    mocks.tryAcquire.mockReturnValue(false);

    const result = await getHistoricalBars({ id: "instrument-1", symbol: "TCS" }, "1M");

    expect(result).toMatchObject({ bars: [], source: "test-provider", status: "unavailable" });
    expect(mocks.fetchHistory).not.toHaveBeenCalled();
  });

  it("fetches quotes and history when a request slot is available", async () => {
    const quote = await getQuoteForSymbol("TCS");
    const history = await getHistoricalBars({ id: "instrument-1", symbol: "TCS" }, "1M");

    expect(quote.status).toBe("fresh");
    expect(history.status).toBe("fresh");
    expect(mocks.tryAcquire).toHaveBeenCalledTimes(2);
    expect(mocks.fetchQuote).toHaveBeenCalledOnce();
    expect(mocks.fetchHistory).toHaveBeenCalledOnce();
  });

  it("by default every instrument quote goes to the provider (existing callers unchanged)", async () => {
    await getQuoteForInstrument({ id: "i1", symbol: "TCS" });
    await getQuoteForInstrument({ id: "i1", symbol: "TCS" });
    expect(mocks.fetchQuote).toHaveBeenCalledTimes(2);
  });

  it("reuses a recent quote when maxAgeMs allows it, without spending rate-limit budget", async () => {
    const first = await getQuoteForInstrument({ id: "i1", symbol: "TCS" }, { maxAgeMs: 55_000 });
    const second = await getQuoteForInstrument({ id: "i1", symbol: "tcs" }, { maxAgeMs: 55_000 });
    expect(mocks.fetchQuote).toHaveBeenCalledOnce();
    expect(mocks.tryAcquire).toHaveBeenCalledOnce();
    expect(second).toEqual(first); // same observedAt: freshness stays honest
  });

  it("never caches or reuses a failed read", async () => {
    mocks.fetchQuote.mockRejectedValueOnce(new Error("boom"));
    const failed = await getQuoteForInstrument({ id: "i1", symbol: "TCS" }, { maxAgeMs: 55_000 });
    expect(failed.status).toBe("unavailable");
    const ok = await getQuoteForInstrument({ id: "i1", symbol: "TCS" }, { maxAgeMs: 55_000 });
    expect(ok.status).toBe("fresh");
    expect(mocks.fetchQuote).toHaveBeenCalledTimes(2);
  });
});

describe("historical bars resilience", () => {
  const bar = { timestamp: new Date("2026-10-23T00:00:00Z"), open: 1, high: 2, low: 1, close: 2 };

  beforeEach(async () => {
    vi.clearAllMocks();
    const { clearHistoryCache } = await import("@/server/modules/market/service");
    clearHistoryCache();
    mocks.tryAcquire.mockReturnValue(true);
  });

  it("serves cached bars without calling the provider again", async () => {
    mocks.fetchHistory.mockResolvedValue([bar]);
    await getHistoricalBars({ id: "i", symbol: "NVDA" }, "1Y");
    const second = await getHistoricalBars({ id: "i", symbol: "NVDA" }, "1Y");
    expect(second.status).toBe("fresh");
    expect(mocks.fetchHistory).toHaveBeenCalledOnce();
  });

  it("retries once after a transient provider failure", async () => {
    mocks.fetchHistory.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce([bar]);
    const result = await getHistoricalBars({ id: "i", symbol: "AAPL" }, "1M");
    expect(result.status).toBe("fresh");
    expect(mocks.fetchHistory).toHaveBeenCalledTimes(2);
  });

  it("reports unavailable when the provider keeps failing and nothing is cached", async () => {
    mocks.fetchHistory.mockRejectedValue(new Error("down"));
    const result = await getHistoricalBars({ id: "i", symbol: "MSFT" }, "3M");
    expect(result).toMatchObject({ bars: [], status: "unavailable" });
  });
});
