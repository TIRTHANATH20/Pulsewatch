import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("YFinanceProvider", () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      DATABASE_URL: "postgresql://localhost:5432/db",
      NLP_SERVICE_URL: "http://localhost:8000",
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

  it("normalizes a quote returned by the Python yfinance service", async () => {
    const fetchMock = mockResponse({
      symbol: "TCS",
      price: 2530,
      currency: "INR",
      exchange: "NSI",
      quoteTime: "2026-10-23T15:28:00+05:30",
      volume: 6857942,
      avgVolume: 4068822,
    });
    const { YFinanceProvider } = await import(
      "@/server/modules/market/providers/yfinance.provider"
    );
    const quote = await new YFinanceProvider().fetchQuote(
      "TCS",
      new AbortController().signal,
    );

    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      "http://localhost:8000/market/TCS/quote",
    );
    expect(quote).toMatchObject({
      symbol: "TCS",
      price: 2530,
      currency: "INR",
      exchange: "NSI",
      volume: 6857942,
      avgVolume: 4068822,
    });
    expect(quote.quoteTime?.toISOString()).toBe("2026-10-23T09:58:00.000Z");
  });

  it("requests the selected history range and parses timezone-aware bars", async () => {
    const fetchMock = mockResponse({
      bars: [
        {
          timestamp: "2026-10-23T15:25:00+05:30",
          open: 2520,
          high: 2535,
          low: 2515,
          close: 2530,
          volume: 86800,
        },
      ],
    });
    const { YFinanceProvider } = await import(
      "@/server/modules/market/providers/yfinance.provider"
    );
    const bars = await new YFinanceProvider().fetchHistory(
      "TCS",
      "1D",
      new AbortController().signal,
    );

    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      "http://localhost:8000/market/TCS/history?range=1D",
    );
    expect(bars).toHaveLength(1);
    expect(bars[0]).toMatchObject({ open: 2520, close: 2530, volume: 86800 });
    expect(bars[0]!.timestamp.toISOString()).toBe("2026-10-23T09:55:00.000Z");
  });

  it("surfaces Python service errors and rejects invalid quote data", async () => {
    mockResponse({ detail: "No quote for INVALID" }, false, 404);
    const { YFinanceProvider } = await import(
      "@/server/modules/market/providers/yfinance.provider"
    );
    await expect(
      new YFinanceProvider().fetchQuote("INVALID", new AbortController().signal),
    ).rejects.toThrow(/status 404: No quote for INVALID/);

    mockResponse({ symbol: "TCS", price: "not-a-price" });
    await expect(
      new YFinanceProvider().fetchQuote("TCS", new AbortController().signal),
    ).rejects.toThrow(/no usable quote/);
  });
});
