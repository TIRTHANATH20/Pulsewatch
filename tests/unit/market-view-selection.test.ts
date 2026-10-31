import { describe, expect, it } from "vitest";
import { marketViewStatus, resolveSelectedSymbol, splitStocks } from "@/lib/market-view";
import type { AttentionItemDTO } from "@/types/attention";

function stock(symbol: string, price: number | null, over: Partial<AttentionItemDTO> = {}): AttentionItemDTO {
  return {
    itemId: `${symbol}-1`, watchlistId: "w1", watchlistName: "W", symbol, name: symbol, exchange: "X",
    status: price === null ? "UNAVAILABLE" : "UNCHANGED", previousPrice: price, currentPrice: price,
    absoluteChange: price === null ? null : 0, percentChange: price === null ? null : 0, attentionScore: 5,
    reason: price === null ? "yfinance service returned status 502" : "", observedAt: price === null ? null : "2026-10-24T09:00:00.000Z",
    quoteTime: null, quoteKind: null, currency: "USD", sparkline: [], volume: null, avgVolume: null, ...over,
  };
}
const FOUR = [stock("TCS", 2530.15), stock("INFY", 1624.9), stock("AAPL", 231.22), stock("MSFT", 425.8)];

describe("Market View stock selection stays consistent with the tracked count", () => {
  it("every tracked stock with a quote is selectable", () => {
    const { selectable, unavailable } = splitStocks(FOUR);
    expect(selectable.map((s) => s.symbol)).toEqual(["TCS", "INFY", "AAPL", "MSFT"]);
    expect(unavailable).toHaveLength(0);
  });
  it("selectable + unavailable always equals the tracked stocks", () => {
    const items = [...FOUR.slice(0, 2), stock("AAPL", null), stock("MSFT", null)];
    const { selectable, unavailable } = splitStocks(items);
    expect(selectable.length + unavailable.length).toBe(4);
    expect(unavailable.map((s) => s.symbol)).toEqual(["AAPL", "MSFT"]);
  });
  it("a null, zero or NaN price is not selectable", () => {
    const { selectable } = splitStocks([stock("A", null), stock("B", 0), stock("C", Number.NaN), stock("D", 5)]);
    expect(selectable.map((s) => s.symbol)).toEqual(["D"]);
  });
  it("the same symbol on two watchlists is one stock", () => {
    const { selectable } = splitStocks([stock("TCS", 1, { itemId: "a", watchlistId: "w1" }), stock("TCS", 1, { itemId: "b", watchlistId: "w2" })]);
    expect(selectable).toHaveLength(1);
  });
  it("prefers the copy with a quote when duplicates disagree", () => {
    const { selectable, unavailable } = splitStocks([stock("TCS", null), stock("TCS", 2530.15, { itemId: "b" })]);
    expect(selectable).toHaveLength(1);
    expect(unavailable).toHaveLength(0);
  });
});

describe("selection resolves when data arrives AFTER the component mounted", () => {
  it("empty at mount -> first stock once items arrive (the original bug left it empty)", () => {
    expect(resolveSelectedSymbol("", splitStocks([]).selectable)).toBe("");
    expect(resolveSelectedSymbol("", splitStocks(FOUR).selectable)).toBe("TCS");
  });
  it("keeps the user's pick while it is still selectable", () => {
    expect(resolveSelectedSymbol("AAPL", splitStocks(FOUR).selectable)).toBe("AAPL");
  });
  it("falls back when the picked stock loses its quote or is removed", () => {
    const items = [stock("TCS", 1), stock("AAPL", null)];
    expect(resolveSelectedSymbol("AAPL", splitStocks(items).selectable)).toBe("TCS");
    expect(resolveSelectedSymbol("GONE", splitStocks(items).selectable)).toBe("TCS");
  });
});

describe("Market View status (loading / error / unavailable are not 'no stocks')", () => {
  it("loading with nothing yet is loading, not 'add your first stock'", () => {
    expect(marketViewStatus({ loadState: "loading", error: null, items: [] })).toEqual({ kind: "loading" });
  });
  it("a failed load says so", () => {
    expect(marketViewStatus({ loadState: "error", error: "boom", items: [] })).toEqual({ kind: "error", message: "boom" });
  });
  it("only a finished load with no stocks means no stocks", () => {
    expect(marketViewStatus({ loadState: "ready", error: null, items: [] })).toEqual({ kind: "no-stocks" });
  });
  it("tracked stocks without any quote are reported as such, with the reason", () => {
    const items = [stock("TCS", null), stock("INFY", null)];
    expect(marketViewStatus({ loadState: "ready", error: null, items })).toEqual({
      kind: "no-quotes", tracked: 2, reason: "yfinance service returned status 502",
    });
  });
  it("partial availability is ready and counts the stocks without a quote", () => {
    const items = [stock("TCS", 1), stock("INFY", null)];
    expect(marketViewStatus({ loadState: "ready", error: null, items })).toEqual({ kind: "ready", tracked: 2, withoutQuote: 1 });
  });
  it("a background reload does not hide stocks already loaded", () => {
    expect(marketViewStatus({ loadState: "loading", error: null, items: FOUR }).kind).toBe("ready");
  });
});
