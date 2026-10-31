import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuoteCache } from "@/server/modules/market/quote-cache";
import { annotateReason } from "@/server/modules/attention/quote-annotation";
import { labelQuote } from "@/server/modules/market/quote-kind";
import { formatFreshness, formatFreshnessShort } from "@/lib/format";

const NOW = new Date("2026-10-24T09:00:00.000Z");
const quote = { symbol: "TCS", price: 1, observedAt: NOW };

describe("QuoteCache", () => {
  it("never serves when maxAge is 0 (default callers always hit the provider)", () => {
    const c = new QuoteCache();
    c.set("k", quote, 1000);
    expect(c.get("k", 0, 1001)).toBeUndefined();
  });
  it("serves within maxAge and expires after it", () => {
    const c = new QuoteCache();
    c.set("k", quote, 1000);
    expect(c.get("k", 55_000, 1000 + 54_999)).toBe(quote);
    expect(c.get("k", 55_000, 1000 + 55_000)).toBeUndefined();
  });
  it("misses for unknown keys", () => {
    expect(new QuoteCache().get("nope", 55_000)).toBeUndefined();
  });
});

describe("honest quote labelling", () => {
  const traded = new Date(NOW.getTime() - 32 * 3600_000);
  const label = labelQuote({ providerName: "yfinance", observedAt: NOW, quoteTime: traded, now: NOW });

  it("annotates an old quote so 'no movement' is not read as live", () => {
    const text = annotateReason("No price movement since your last visit.", label, undefined, NOW);
    expect(text).toMatch(/32 hr ago/);
    expect(text).toMatch(/market may be closed or the feed delayed/i);
  });
  it("says the market is closed when the provider reports it", () => {
    const closed = labelQuote({ providerName: "twelvedata", observedAt: NOW, quoteTime: traded, marketOpen: false, now: NOW });
    expect(annotateReason("x", closed, false, NOW)).toMatch(/Market is closed/);
  });
  it("leaves a recent quote's reason alone", () => {
    const recent = labelQuote({ providerName: "yfinance", observedAt: NOW, quoteTime: new Date(NOW.getTime() - 60_000), now: NOW });
    expect(annotateReason("same", recent, undefined, NOW)).toBe("same");
    expect(annotateReason("same", null, undefined, NOW)).toBe("same");
  });
});

describe("freshness labels use the trade time, not the fetch time", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });
  const fetched = NOW.toISOString();

  it("old trade -> 'Last trade N hr ago' even though it was fetched just now", () => {
    const traded = new Date(NOW.getTime() - 32 * 3600_000).toISOString();
    expect(formatFreshness(fetched, "UNCHANGED", traded)).toBe("Last trade 32 hr ago");
    expect(formatFreshnessShort(fetched, "UNCHANGED", traded)).toBe("last trade 32 hr ago");
  });
  it("recent trade or no trade time -> 'As of ...' from the fetch time", () => {
    expect(formatFreshness(fetched, "UNCHANGED", new Date(NOW.getTime() - 60_000).toISOString())).toBe("As of just now");
    expect(formatFreshness(fetched, "UNCHANGED")).toBe("As of just now");
  });
  it("stale and unavailable keep their own wording", () => {
    expect(formatFreshness(fetched, "STALE", null)).toBe("Last known price · just now");
    expect(formatFreshness(null, "UNAVAILABLE")).toBe("No data available");
  });
});
