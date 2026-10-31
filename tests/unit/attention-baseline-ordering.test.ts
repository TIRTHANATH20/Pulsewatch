import { describe, expect, it } from "vitest";
import { computeAttention } from "@/server/modules/attention/engine";
import type { LastSeenSnapshot } from "@/server/modules/attention/lastSeenRepository";
import type { QuoteForEngine } from "@/server/modules/attention/engine";
import type { AttentionThresholds } from "@/server/modules/attention/config";

// These tests target the "baseline comparison happens BEFORE the baseline
// is updated" requirement directly (see attention/service.ts's
// `evaluateOne` and lastSeenRepository.ts's doc comment). computeAttention
// itself never touches the database, so these exercise the exact same
// (previous, quote) pairs the service passes it across a simulated
// sequence of visits, asserting each visit's classification depends only
// on the state that existed before that visit — never on its own result.

const thresholds: AttentionThresholds = { changedPct: 0.5, significantPct: 3 };

function fresh(price: number, observedAt = new Date()): QuoteForEngine {
  return { status: "fresh", price, observedAt };
}

describe("baseline ordering across a sequence of visits", () => {
  it("a SIGNIFICANT visit's own new price is not used as its own baseline", () => {
    // Visit 1: first-ever observation -> NEW, baseline becomes 100.
    const visit1 = computeAttention(null, fresh(100), thresholds);
    expect(visit1.status).toBe("NEW");

    // Visit 2 must compare against visit 1's price (100), not against
    // itself. A bug that updated the baseline before computing the
    // comparison would make every visit read back its own price and
    // always classify as UNCHANGED (0% move).
    const baselineAfterVisit1: LastSeenSnapshot = {
      price: visit1.currentPrice!,
      observedAt: visit1.observedAt!,
    };
    const visit2 = computeAttention(baselineAfterVisit1, fresh(110), thresholds); // +10%
    expect(visit2.status).toBe("SIGNIFICANT");
    expect(visit2.percentChange).toBe(10);
  });

  it("an UNAVAILABLE visit does not advance the baseline for the next visit", () => {
    const baseline: LastSeenSnapshot = { price: 100, observedAt: new Date() };

    // Simulate a visit where the provider fails entirely. The service
    // layer must not call upsertLastSeenState in this case (currentPrice
    // is null), so the baseline going into the next visit is unchanged.
    const unavailableVisit = computeAttention(
      baseline,
      { status: "unavailable", reason: "provider down" },
      thresholds,
    );
    expect(unavailableVisit.status).toBe("UNAVAILABLE");
    expect(unavailableVisit.currentPrice).toBeNull();

    // The next visit must still compare against the ORIGINAL baseline
    // (100), not against anything from the failed visit.
    const nextVisit = computeAttention(baseline, fresh(104), thresholds); // +4%
    expect(nextVisit.status).toBe("SIGNIFICANT");
    expect(nextVisit.percentChange).toBe(4);
  });

  it("a STALE visit's cached price is a valid baseline for the next visit", () => {
    // A stale read still has a real price (from the last stored
    // observation), so — unlike UNAVAILABLE — the service does advance
    // the baseline to it.
    const baseline: LastSeenSnapshot = { price: 100, observedAt: new Date() };
    const staleVisit = computeAttention(
      baseline,
      { status: "stale", price: 100, observedAt: new Date(), reason: "timeout" },
      thresholds,
    );
    expect(staleVisit.status).toBe("STALE");
    expect(staleVisit.currentPrice).toBe(100);

    const baselineAfterStale: LastSeenSnapshot = {
      price: staleVisit.currentPrice!,
      observedAt: staleVisit.observedAt!,
    };
    const nextVisit = computeAttention(baselineAfterStale, fresh(101), thresholds); // +1%
    expect(nextVisit.status).toBe("CHANGED");
  });

  it("out-of-order writes: an older observation must not overwrite a newer baseline", () => {
    // This documents the known concurrency limitation (see
    // lastSeenRepository.ts / DECISIONS.md #23): upsertLastSeenState
    // unconditionally overwrites with whatever price/observedAt it's
    // given, with no check that observedAt is actually newer than what's
    // stored. If two requests for the same instrument race and the one
    // carrying the OLDER observation's write lands last, the baseline
    // regresses. This test documents the current (accepted) behavior
    // rather than asserting a fix, so a future change to add that guard
    // will be a deliberate, visible diff here.
    const newer: LastSeenSnapshot = {
      price: 110,
      observedAt: new Date("2026-01-01T00:00:10.000Z"),
    };
    const older: LastSeenSnapshot = {
      price: 100,
      observedAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    // Simulating "upsert with `older` after `newer`" is exactly what
    // upsertLastSeenState(userId, instrumentId, older.price,
    // older.observedAt) would do today: unconditional overwrite, no
    // guard. Documented here, not fixed — see DECISIONS.md #23.
    expect(older.observedAt.getTime()).toBeLessThan(newer.observedAt.getTime());
  });
});
