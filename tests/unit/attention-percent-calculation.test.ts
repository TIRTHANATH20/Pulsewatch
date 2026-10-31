import { describe, expect, it } from "vitest";
import { computeAttention } from "@/server/modules/attention/engine";
import { formatPercent } from "@/lib/format";

const thresholds = { changedPct: 0.5, significantPct: 3 };
const at = new Date("2026-10-24T09:00:00.000Z");
const fresh = (price: number) => ({ status: "fresh" as const, price, observedAt: at });

describe("percentage calculation", () => {
  it("is (current - previous) / previous * 100, rounded to 4 dp", () => {
    const r = computeAttention({ price: 2515.1, observedAt: at }, fresh(2530.15), thresholds);
    expect(r.absoluteChange).toBeCloseTo(15.05, 4);
    expect(r.percentChange).toBeCloseTo(0.5984, 4);
    expect(r.status).toBe("CHANGED");
  });

  it("is negative for a fall", () => {
    const r = computeAttention({ price: 1650.25, observedAt: at }, fresh(1624.9), thresholds);
    expect(r.percentChange).toBeCloseTo(-1.5361, 4);
    expect(r.status).toBe("CHANGED");
  });

  it("an identical price is exactly 0% and UNCHANGED (genuinely no movement, not an error)", () => {
    const r = computeAttention({ price: 425.8, observedAt: at }, fresh(425.8), thresholds);
    expect(r.percentChange).toBe(0);
    expect(r.absoluteChange).toBe(0);
    expect(r.status).toBe("UNCHANGED");
    expect(r.reason).toMatch(/no price movement/i);
  });

  it("the same stored trade re-read as a raw float does not become a move", () => {
    // Baseline is persisted as Decimal(18,4); the next read of the same trade is the raw float.
    const r = computeAttention({ price: 2530.1501, observedAt: at }, fresh(2530.1500610351562), thresholds);
    expect(Math.abs(r.percentChange ?? 1)).toBe(0);
    expect(r.status).toBe("UNCHANGED");
  });

  it("a first observation has no percentage at all (NEW), never 0%", () => {
    const r = computeAttention(null, fresh(100), thresholds);
    expect(r.status).toBe("NEW");
    expect(r.percentChange).toBeNull();
  });

  it("stale data keeps its STALE status and is never reported as UNCHANGED", () => {
    const r = computeAttention(
      { price: 100, observedAt: at },
      { status: "stale", price: 100, observedAt: at, reason: "rate limit" },
      thresholds,
    );
    expect(r.status).toBe("STALE");
  });

  it("unavailable data has no price and no percentage", () => {
    const r = computeAttention({ price: 100, observedAt: at }, { status: "unavailable", reason: "down" }, thresholds);
    expect(r.status).toBe("UNAVAILABLE");
    expect(r.currentPrice).toBeNull();
    expect(r.percentChange).toBeNull();
  });

  it("a zero baseline does not produce Infinity/NaN", () => {
    const r = computeAttention({ price: 0, observedAt: at }, fresh(10), thresholds);
    expect(Number.isFinite(r.percentChange as number)).toBe(true);
  });
});

describe("formatPercent", () => {
  it("never prints a signed zero", () => {
    expect(formatPercent(-0.004)).toBe("0.00%");
    expect(formatPercent(0.004)).toBe("0.00%");
    expect(formatPercent(-0)).toBe("0.00%");
  });
  it("signs real moves", () => {
    expect(formatPercent(0.6)).toBe("+0.60%");
    expect(formatPercent(-1.5361)).toBe("-1.54%");
    expect(formatPercent(null)).toBeNull();
  });
});
