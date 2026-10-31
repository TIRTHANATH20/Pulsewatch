import type { AttentionThresholds } from "./config";
import type { LastSeenSnapshot } from "./lastSeenRepository";

export type AttentionStatus =
  | "NEW"
  | "UNCHANGED"
  | "CHANGED"
  | "SIGNIFICANT"
  | "STALE"
  | "UNAVAILABLE";

// Deliberately structurally identical to market/types.ts's `QuoteOutcome`
// rather than importing it directly — the engine should only ever depend
// on the shape of data it needs (price/observedAt/reason), not on the
// market module itself, so it stays trivially unit-testable with plain
// object literals and has no import-order coupling to `getEnv()`.
export interface QuoteForEngine {
  status: "fresh" | "stale" | "unavailable";
  price?: number;
  observedAt?: Date;
  reason?: string;
}

export interface AttentionComputation {
  status: AttentionStatus;
  previousPrice: number | null;
  currentPrice: number | null;
  absoluteChange: number | null;
  percentChange: number | null;
  // 0-100. Higher = more deserving of the user's attention. Used purely
  // for sort order among items in the same status bucket — see
  // attention/service.ts.
  attentionScore: number;
  reason: string;
  observedAt: Date | null;
}

const DECIMALS = 4;

function round(n: number): number {
  const factor = 10 ** DECIMALS;
  return Math.round(n * factor) / factor;
}

function percentChangeOf(current: number, previous: number): number {
  if (previous === 0) {
    // A previous price of exactly 0 is not a realistic market price, but
    // guard against a division by zero producing Infinity/NaN rather
    // than silently propagating a broken number into the UI.
    return current === 0 ? 0 : 100;
  }
  return ((current - previous) / previous) * 100;
}

function formatSigned(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n}`;
}

function ageMinutes(observedAt: Date): number {
  return Math.max(0, Math.round((Date.now() - observedAt.getTime()) / 60000));
}

function clampScore(n: number): number {
  return Math.min(100, Math.max(0, Math.round(n)));
}

// The core, deterministic comparison. Given what the user last saw (or
// null on a first visit) and the current quote outcome, returns exactly
// one classification with a human-readable reason. Pure and
// side-effect-free — no DB access, no env access, no Date.now() baked
// into anything the caller can't also compute (ageMinutes is the one
// exception, used only for display text, not for classification) — so
// the same (previous, quote, thresholds) triple always yields the same
// result.
export function computeAttention(
  previous: LastSeenSnapshot | null,
  quote: QuoteForEngine,
  thresholds: AttentionThresholds,
): AttentionComputation {
  if (quote.status === "unavailable") {
    return {
      status: "UNAVAILABLE",
      previousPrice: previous?.price ?? null,
      currentPrice: null,
      absoluteChange: null,
      percentChange: null,
      attentionScore: 0,
      reason:
        quote.reason ??
        "Market data is currently unavailable for this instrument.",
      observedAt: null,
    };
  }

  const currentPrice = quote.price as number;
  const observedAt = quote.observedAt as Date;

  if (quote.status === "stale") {
    const absoluteChange = previous ? round(currentPrice - previous.price) : null;
    const percentChange =
      previous !== null
        ? round(percentChangeOf(currentPrice, previous.price))
        : null;
    return {
      status: "STALE",
      previousPrice: previous?.price ?? null,
      currentPrice,
      absoluteChange,
      percentChange,
      attentionScore: previous ? 15 : 5,
      reason: `Showing the last known price (${ageMinutes(observedAt)} min old) — ${
        quote.reason ?? "live data is temporarily unavailable"
      }.`,
      observedAt,
    };
  }

  // status === "fresh"
  if (!previous) {
    return {
      status: "NEW",
      previousPrice: null,
      currentPrice,
      absoluteChange: null,
      percentChange: null,
      attentionScore: 20,
      reason:
        "First time you're seeing this instrument — no prior baseline to compare against yet.",
      observedAt,
    };
  }

  const absoluteChange = round(currentPrice - previous.price);
  const percentChange = round(percentChangeOf(currentPrice, previous.price));
  const absPercent = Math.abs(percentChange);

  if (absPercent >= thresholds.significantPct) {
    return {
      status: "SIGNIFICANT",
      previousPrice: previous.price,
      currentPrice,
      absoluteChange,
      percentChange,
      attentionScore: clampScore(
        70 + (absPercent - thresholds.significantPct) * 3,
      ),
      reason: `Moved ${formatSigned(percentChange)}% (${formatSigned(
        absoluteChange,
      )}) since your last visit — above the ${thresholds.significantPct}% significant-move threshold.`,
      observedAt,
    };
  }

  if (absPercent >= thresholds.changedPct) {
    return {
      status: "CHANGED",
      previousPrice: previous.price,
      currentPrice,
      absoluteChange,
      percentChange,
      attentionScore: clampScore(30 + (absPercent - thresholds.changedPct) * 5),
      reason: `Moved ${formatSigned(percentChange)}% (${formatSigned(
        absoluteChange,
      )}) since your last visit.`,
      observedAt,
    };
  }

  return {
    status: "UNCHANGED",
    previousPrice: previous.price,
    currentPrice,
    absoluteChange,
    percentChange,
    attentionScore: 5,
    reason:
      absoluteChange === 0
        ? "No price movement since your last visit."
        : `Only moved ${formatSigned(percentChange)}% (${formatSigned(
            absoluteChange,
          )}) since your last visit — below the ${thresholds.changedPct}% threshold.`,
    observedAt,
  };
}
