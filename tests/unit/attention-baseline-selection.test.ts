import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  getLastSeenState: vi.fn(),
  upsertLastSeenState: vi.fn(),
  getQuoteForInstrument: vi.fn(),
  getRecentPriceHistory: vi.fn(),
}));

vi.mock("@/server/db/prisma", () => ({ prisma: { watchlist: { findMany: mocks.findMany } } }));
vi.mock("@/server/modules/attention/lastSeenRepository", () => ({
  getLastSeenState: mocks.getLastSeenState,
  upsertLastSeenState: mocks.upsertLastSeenState,
}));
vi.mock("@/server/modules/attention/config", () => ({
  getAttentionThresholds: () => ({ changedPct: 0.5, significantPct: 3 }),
}));
vi.mock("@/server/modules/market", () => ({
  getQuoteForInstrument: mocks.getQuoteForInstrument,
  getRecentPriceHistory: mocks.getRecentPriceHistory,
}));
vi.mock("@/server/modules/market/provider-factory", () => ({
  getMarketDataProvider: () => ({ name: "yfinance" }),
}));

import { getAttentionForUser } from "@/server/modules/attention/service";
import { QUOTE_MAX_AGE_MS, shouldAdvanceBaseline } from "@/server/modules/attention/baseline-policy";

const FETCHED = new Date("2026-10-24T09:00:00.000Z");
const TRADED = new Date("2026-10-23T09:59:00.000Z"); // Friday close

describe("baseline selection: visit vs background poll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([
      { id: "wl1", name: "Demo", items: [{ id: "it1", instrument: { id: "ins1", symbol: "TCS", name: "TCS", exchange: "NSE" } }] },
    ]);
    mocks.getLastSeenState.mockResolvedValue({ price: 2515.1, observedAt: new Date("2026-10-23T05:00:00.000Z") });
    mocks.getQuoteForInstrument.mockResolvedValue({ status: "fresh", price: 2530.15, observedAt: FETCHED, quoteTime: TRADED, currency: "INR" });
    mocks.getRecentPriceHistory.mockResolvedValue([]);
  });

  it("a visit compares with the stored baseline and then advances it", async () => {
    const [item] = await getAttentionForUser("u1", undefined, { kind: "visit" });
    expect(item?.previousPrice).toBe(2515.1);
    expect(item?.status).toBe("CHANGED");
    expect(mocks.upsertLastSeenState).toHaveBeenCalledTimes(1);
    expect(mocks.upsertLastSeenState).toHaveBeenCalledWith("u1", "ins1", 2530.15, FETCHED);
  });

  it("defaults to a visit when no kind is given (existing callers unchanged)", async () => {
    await getAttentionForUser("u1");
    expect(mocks.upsertLastSeenState).toHaveBeenCalledTimes(1);
  });

  it("a background poll compares with the baseline but NEVER moves it", async () => {
    const [item] = await getAttentionForUser("u1", undefined, { kind: "poll" });
    expect(item?.previousPrice).toBe(2515.1);
    expect(mocks.upsertLastSeenState).not.toHaveBeenCalled();
  });

  it("polls ask the market module for a reusable quote; visits for a fresher one", async () => {
    await getAttentionForUser("u1", undefined, { kind: "poll" });
    await getAttentionForUser("u1", undefined, { kind: "visit" });
    expect(mocks.getQuoteForInstrument.mock.calls[0]?.[1]).toEqual({ maxAgeMs: QUOTE_MAX_AGE_MS.poll });
    expect(mocks.getQuoteForInstrument.mock.calls[1]?.[1]).toEqual({ maxAgeMs: QUOTE_MAX_AGE_MS.visit });
    expect(QUOTE_MAX_AGE_MS.poll).toBeGreaterThan(QUOTE_MAX_AGE_MS.visit);
  });

  it("drift below the threshold accumulates across polls because the baseline stays put", async () => {
    // Each poll sees +0.2% more than the last, always against the SAME baseline (100).
    mocks.getLastSeenState.mockResolvedValue({ price: 100, observedAt: new Date("2026-10-23T05:00:00.000Z") });
    const statuses: string[] = [];
    for (const price of [100.2, 100.4, 100.6, 100.8]) {
      mocks.getQuoteForInstrument.mockResolvedValue({ status: "fresh", price, observedAt: FETCHED });
      const [item] = await getAttentionForUser("u1", undefined, { kind: "poll" });
      statuses.push(item?.status ?? "none");
    }
    expect(statuses).toEqual(["UNCHANGED", "UNCHANGED", "CHANGED", "CHANGED"]);
  });

  it("an unavailable quote never advances the baseline, even on a visit", async () => {
    mocks.getQuoteForInstrument.mockResolvedValue({ status: "unavailable", reason: "provider down" });
    const [item] = await getAttentionForUser("u1", undefined, { kind: "visit" });
    expect(item?.status).toBe("UNAVAILABLE");
    expect(item?.currentPrice).toBeNull();
    expect(mocks.upsertLastSeenState).not.toHaveBeenCalled();
  });

  it("reports the provider's trade time and explains an old quote honestly", async () => {
    const [item] = await getAttentionForUser("u1", undefined, { kind: "visit" });
    expect(item?.quoteTime).toBe(TRADED.toISOString());
    expect(item?.quoteKind).toBe("delayed");
    expect(item?.reason).toMatch(/market may be closed or the feed delayed/i);
  });

  it("shouldAdvanceBaseline: only a visit with a real price", () => {
    const priced = { currentPrice: 1, observedAt: FETCHED };
    expect(shouldAdvanceBaseline("visit", priced)).toBe(true);
    expect(shouldAdvanceBaseline("poll", priced)).toBe(false);
    expect(shouldAdvanceBaseline("visit", { currentPrice: null, observedAt: null })).toBe(false);
  });
});
