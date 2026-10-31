import { describe, expect, it } from "vitest";
import { isSparklineDrawable } from "@/lib/sparkline";
import { mergePolledItems } from "@/lib/attention-merge";
import type { AttentionItemDTO } from "@/types/attention";

describe("sparkline history validity (missing / flat history is never drawn)", () => {
  it("rejects missing, empty and single-point history", () => {
    expect(isSparklineDrawable(undefined)).toBe(false);
    expect(isSparklineDrawable(null)).toBe(false);
    expect(isSparklineDrawable([])).toBe(false);
    expect(isSparklineDrawable([100])).toBe(false);
  });
  it("rejects repeated identical samples (they render as a blank horizontal rule)", () => {
    expect(isSparklineDrawable([2530.15, 2530.15, 2530.15, 2530.15])).toBe(false);
  });
  it("rejects non-finite values", () => {
    expect(isSparklineDrawable([1, Number.NaN, 2])).toBe(false);
    expect(isSparklineDrawable([1, Number.POSITIVE_INFINITY])).toBe(false);
  });
  it("accepts real movement", () => {
    expect(isSparklineDrawable([2515.1, 2530.15])).toBe(true);
    expect(isSparklineDrawable([1, 1, 1, 2])).toBe(true);
  });
});

function item(over: Partial<AttentionItemDTO>): AttentionItemDTO {
  return {
    itemId: "i1", watchlistId: "w1", watchlistName: "W", symbol: "TCS", name: "TCS", exchange: "NSE",
    status: "CHANGED", previousPrice: 2515.1, currentPrice: 2530.15, absoluteChange: 15.05, percentChange: 0.5984,
    attentionScore: 30, reason: "Moved +0.5984%", observedAt: "2026-10-24T09:00:00.000Z",
    quoteTime: null, quoteKind: null, currency: "INR", sparkline: [], volume: null, avgVolume: null, ...over,
  };
}

describe("mergePolledItems", () => {
  it("keeps the since-last-visit result when the polled price has not moved", () => {
    const shown = [item({})];
    const polled = [item({ status: "UNCHANGED", previousPrice: 2530.15, absoluteChange: 0, percentChange: 0, reason: "No price movement", observedAt: "2026-10-24T09:00:25.000Z", sparkline: [1, 2] })];
    const [merged] = mergePolledItems(shown, polled);
    expect(merged?.status).toBe("CHANGED");
    expect(merged?.percentChange).toBe(0.5984);
    expect(merged?.observedAt).toBe("2026-10-24T09:00:25.000Z"); // freshness still updates
    expect(merged?.sparkline).toEqual([1, 2]);
  });
  it("takes the poll's own comparison once the price moves", () => {
    const polled = [item({ status: "CHANGED", currentPrice: 2540, percentChange: 0.99 })];
    expect(mergePolledItems([item({})], polled)[0]?.percentChange).toBe(0.99);
  });
  it("never hides stale/unavailable polls behind an old result", () => {
    const polled = [item({ status: "STALE" })];
    expect(mergePolledItems([item({})], polled)[0]?.status).toBe("STALE");
  });
  it("passes through items it has not seen before", () => {
    const polled = [item({ itemId: "new", status: "NEW" })];
    expect(mergePolledItems([], polled)).toEqual(polled);
  });
});
