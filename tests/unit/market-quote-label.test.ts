import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { labelQuote } from "@/server/modules/market/quote-kind";

const NOW = new Date("2026-10-15T10:00:00.000Z");
const min = (m: number) => new Date(NOW.getTime() - m * 60_000);

describe("labelQuote", () => {
  it("simulated provider is always labelled simulated", () => {
    const l = labelQuote({ providerName: "simulated", observedAt: min(0), now: NOW });
    expect(l.kind).toBe("simulated");
    expect(l.note).toMatch(/not a real market feed/i);
  });
  it("a recent quote from an open market is live", () => {
    expect(labelQuote({ providerName: "twelvedata", observedAt: NOW, quoteTime: min(2), marketOpen: true, now: NOW }).kind).toBe("live");
  });
  it("yfinance quotes are labelled delayed because real-time delivery is not guaranteed", () => {
    const label = labelQuote({
      providerName: "yfinance",
      observedAt: NOW,
      quoteTime: min(2),
      marketOpen: true,
      now: NOW,
    });
    expect(label.kind).toBe("delayed");
    expect(label.note).toMatch(/does not guarantee real-time/i);
  });
  it("a closed market is never labelled live, even though it was fetched just now", () => {
    const l = labelQuote({ providerName: "twelvedata", observedAt: NOW, quoteTime: min(600), marketOpen: false, now: NOW });
    expect(l.kind).toBe("delayed");
    expect(l.asOf.toISOString()).toBe(min(600).toISOString());
    expect(l.note).toMatch(/closed/i);
  });
  it("an old quote time is delayed even if the open flag is missing", () => {
    expect(labelQuote({ providerName: "twelvedata", observedAt: NOW, quoteTime: min(45), now: NOW }).kind).toBe("delayed");
  });
  it("without a provider quote time it falls back to fetch time and says so", () => {
    const l = labelQuote({ providerName: "twelvedata", observedAt: NOW, now: NOW });
    expect(l.kind).toBe("live");
    expect(l.note).toMatch(/did not report a quote time/);
  });
});

describe("TwelveDataProvider.fetchQuote (mocked fetch)", () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  beforeEach(() => {
    process.env = { ...originalEnv, DATABASE_URL: "postgresql://u:p@localhost:5432/db", TWELVE_DATA_API_KEY: "td-test-key" };
    vi.resetModules();
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });
  const mockBody = (body: unknown, ok = true, status = 200) => {
    const f = vi.fn().mockResolvedValue({ ok, status, json: async () => body });
    global.fetch = f as unknown as typeof fetch;
    return f;
  };

  it("parses quote time and market-open flag", async () => {
    mockBody({ symbol: "AAPL", close: "228.50", currency: "USD", exchange: "NASDAQ", timestamp: 1760522400, is_market_open: false });
    const { TwelveDataProvider } = await import("@/server/modules/market/providers/twelve-data.provider");
    const q = await new TwelveDataProvider().fetchQuote("AAPL", new AbortController().signal);
    expect(q.price).toBe(228.5);
    expect(q.marketOpen).toBe(false);
    expect(q.quoteTime?.toISOString()).toBe("2025-10-15T10:00:00.000Z");
  });

  it("leaves quoteTime/marketOpen undefined when the payload lacks them", async () => {
    mockBody({ symbol: "AAPL", close: "10" });
    const { TwelveDataProvider } = await import("@/server/modules/market/providers/twelve-data.provider");
    const q = await new TwelveDataProvider().fetchQuote("AAPL", new AbortController().signal);
    expect(q.quoteTime).toBeUndefined();
    expect(q.marketOpen).toBeUndefined();
  });

  it("maps provider error bodies (HTTP 200 + status:error) and HTTP failures to ProviderRequestError", async () => {
    mockBody({ status: "error", code: 401, message: "apikey invalid" });
    const { TwelveDataProvider } = await import("@/server/modules/market/providers/twelve-data.provider");
    const err = await new TwelveDataProvider().fetchQuote("AAPL", new AbortController().signal).catch((e) => e);
    expect(err.name).toBe("ProviderRequestError");
    mockBody({}, false, 429);
    const err2 = await new TwelveDataProvider().fetchQuote("AAPL", new AbortController().signal).catch((e) => e);
    expect(err2.message).toMatch(/429/);
  });

  it("refuses to call the API without a key and URL-encodes the symbol", async () => {
    delete process.env.TWELVE_DATA_API_KEY;
    const f = mockBody({ close: "1" });
    vi.resetModules();
    const { TwelveDataProvider } = await import("@/server/modules/market/providers/twelve-data.provider");
    const err = await new TwelveDataProvider().fetchQuote("AAPL", new AbortController().signal).catch((e) => e);
    expect(err.message).toMatch(/TWELVE_DATA_API_KEY is not configured/);
    expect(f).not.toHaveBeenCalled();
  });
});
