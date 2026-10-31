import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("TwelveDataProvider", () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      DATABASE_URL: "postgresql://localhost:5432/db",
      MARKET_DATA_PROVIDER: "twelvedata",
      TWELVE_DATA_API_KEY: "test-key-not-real",
    };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  function mockResponse(body: unknown, ok = true, status = 200) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok,
      status,
      json: async () => body,
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  it("parses the documented quote fields and converts epoch seconds", async () => {
    const fetchMock = mockResponse({
      symbol: "AAPL",
      exchange: "NASDAQ",
      currency: "USD",
      close: "231.50",
      timestamp: 1792863000,
      is_market_open: false,
    });
    const { TwelveDataProvider } = await import(
      "@/server/modules/market/providers/twelve-data.provider"
    );
    const quote = await new TwelveDataProvider().fetchQuote(
      "AAPL",
      new AbortController().signal,
    );

    expect(String(fetchMock.mock.calls[0]![0])).toContain("symbol=AAPL");
    expect(quote).toMatchObject({
      symbol: "AAPL",
      price: 231.5,
      exchange: "NASDAQ",
      currency: "USD",
      marketOpen: false,
    });
    expect(quote.quoteTime?.toISOString()).toBe(
      new Date(1792863000 * 1000).toISOString(),
    );
  });

  it("requests UTC history and returns validated bars in ascending time order", async () => {
    const fetchMock = mockResponse({
      values: [
        {
          datetime: "2026-10-23 15:00:00",
          open: "231",
          high: "233",
          low: "230",
          close: "232",
          volume: "1000",
        },
        {
          datetime: "2026-10-22 15:00:00",
          open: "229",
          high: "232",
          low: "228",
          close: "231",
          volume: "900",
        },
        { datetime: "invalid", open: "x", close: "x" },
      ],
    });
    const { TwelveDataProvider } = await import(
      "@/server/modules/market/providers/twelve-data.provider"
    );
    const bars = await new TwelveDataProvider().fetchHistory(
      "AAPL",
      "1M",
      new AbortController().signal,
    );

    expect(String(fetchMock.mock.calls[0]![0])).toContain("timezone=UTC");
    expect(bars).toHaveLength(2);
    expect(bars[0]?.timestamp.toISOString()).toBe("2026-10-22T15:00:00.000Z");
    expect(bars[0]).toMatchObject({
      open: 229,
      high: 232,
      low: 228,
      close: 231,
      volume: 900,
    });
  });

  it("surfaces HTTP-200 provider errors and rejects malformed quote prices", async () => {
    mockResponse({ status: "error", code: 401, message: "Invalid API key" });
    const { TwelveDataProvider } = await import(
      "@/server/modules/market/providers/twelve-data.provider"
    );
    await expect(
      new TwelveDataProvider().fetchQuote("AAPL", new AbortController().signal),
    ).rejects.toThrow(/Invalid API key/);

    mockResponse({ close: "not-a-price" });
    await expect(
      new TwelveDataProvider().fetchQuote("AAPL", new AbortController().signal),
    ).rejects.toThrow(/non-numeric price/);
  });
});
