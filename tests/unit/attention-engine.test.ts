import { describe, expect, it } from "vitest";
import { computeAttention } from "@/server/modules/attention/engine";
import type { LastSeenSnapshot } from "@/server/modules/attention/lastSeenRepository";
import type { QuoteForEngine } from "@/server/modules/attention/engine";
import type { AttentionThresholds } from "@/server/modules/attention/config";

const thresholds: AttentionThresholds = { changedPct: 0.5, significantPct: 3 };

function freshQuote(price: number, observedAt = new Date()): QuoteForEngine {
  return { status: "fresh", price, observedAt };
}

describe("computeAttention", () => {
  it("classifies NEW when there is no previous observation", () => {
    const result = computeAttention(null, freshQuote(100), thresholds);
    expect(result.status).toBe("NEW");
    expect(result.previousPrice).toBeNull();
    expect(result.currentPrice).toBe(100);
  });

  it("classifies UNCHANGED for a move below the changed threshold", () => {
    const previous: LastSeenSnapshot = { price: 100, observedAt: new Date() };
    const result = computeAttention(previous, freshQuote(100.2), thresholds); // 0.2%
    expect(result.status).toBe("UNCHANGED");
  });

  it("classifies CHANGED for a move at exactly the changed threshold (boundary)", () => {
    const previous: LastSeenSnapshot = { price: 100, observedAt: new Date() };
    const result = computeAttention(previous, freshQuote(100.5), thresholds); // exactly 0.5%
    expect(result.status).toBe("CHANGED");
  });

  it("classifies SIGNIFICANT for a move at exactly the significant threshold (boundary)", () => {
    const previous: LastSeenSnapshot = { price: 100, observedAt: new Date() };
    const result = computeAttention(previous, freshQuote(103), thresholds); // exactly 3%
    expect(result.status).toBe("SIGNIFICANT");
  });

  it("classifies CHANGED just below the significant threshold", () => {
    const previous: LastSeenSnapshot = { price: 100, observedAt: new Date() };
    const result = computeAttention(previous, freshQuote(102.99), thresholds);
    expect(result.status).toBe("CHANGED");
  });

  it("treats a negative move using its absolute percentage", () => {
    const previous: LastSeenSnapshot = { price: 100, observedAt: new Date() };
    const result = computeAttention(previous, freshQuote(96), thresholds); // -4%
    expect(result.status).toBe("SIGNIFICANT");
    expect(result.percentChange).toBeLessThan(0);
  });

  it("guards against division by zero when previous price is 0", () => {
    const previous: LastSeenSnapshot = { price: 0, observedAt: new Date() };
    const result = computeAttention(previous, freshQuote(50), thresholds);
    expect(Number.isFinite(result.percentChange)).toBe(true);
    expect(result.percentChange).toBe(100);
  });

  it("does not divide by zero when both previous and current price are 0", () => {
    const previous: LastSeenSnapshot = { price: 0, observedAt: new Date() };
    const result = computeAttention(previous, freshQuote(0), thresholds);
    expect(result.percentChange).toBe(0);
    expect(result.status).toBe("UNCHANGED");
  });

  it("classifies UNAVAILABLE when the quote has no data, regardless of baseline", () => {
    const previous: LastSeenSnapshot = { price: 100, observedAt: new Date() };
    const result = computeAttention(
      previous,
      { status: "unavailable", reason: "provider down" },
      thresholds,
    );
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.currentPrice).toBeNull();
    // The previous baseline is still surfaced for display purposes even
    // though it is not compared against.
    expect(result.previousPrice).toBe(100);
  });

  it("classifies STALE when the quote is a cached fallback, and still computes a delta", () => {
    const previous: LastSeenSnapshot = { price: 100, observedAt: new Date() };
    const result = computeAttention(
      previous,
      { status: "stale", price: 105, observedAt: new Date(), reason: "provider timeout" },
      thresholds,
    );
    expect(result.status).toBe("STALE");
    expect(result.currentPrice).toBe(105);
    expect(result.percentChange).toBe(5);
  });

  it("keeps attentionScore within 0-100 bounds for extreme moves", () => {
    const previous: LastSeenSnapshot = { price: 100, observedAt: new Date() };
    const result = computeAttention(previous, freshQuote(1000), thresholds); // +900%
    expect(result.attentionScore).toBeLessThanOrEqual(100);
    expect(result.attentionScore).toBeGreaterThanOrEqual(0);
  });
});
