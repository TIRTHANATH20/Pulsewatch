import type { AttentionItemDTO } from "@/types/attention";

// A user-initiated load compares prices with the user's LAST VISIT and then
// moves the server-side baseline to the current price. A background poll
// therefore compares with that new baseline, so while nothing trades (nights,
// weekends) it would report "UNCHANGED 0.00%" and wipe out the since-last-
// visit result the user was just shown.
//
// Rule: if a poll shows the price has not moved since what the user is already
// looking at, keep that item's existing comparison (status, previous price,
// change, reason) and take only the freshness fields from the poll. As soon as
// the price does move, the poll's own comparison replaces it.
const NOTABLE = new Set(["NEW", "CHANGED", "SIGNIFICANT"]);

export function mergePolledItems(
  current: AttentionItemDTO[],
  polled: AttentionItemDTO[],
): AttentionItemDTO[] {
  const byId = new Map(current.map((i) => [i.itemId, i]));
  return polled.map((next) => {
    const prev = byId.get(next.itemId);
    if (
      prev &&
      NOTABLE.has(prev.status) &&
      next.status === "UNCHANGED" &&
      prev.currentPrice !== null &&
      prev.currentPrice === next.currentPrice
    ) {
      return {
        ...prev,
        observedAt: next.observedAt,
        quoteTime: next.quoteTime,
        quoteKind: next.quoteKind,
        sparkline: next.sparkline,
        volume: next.volume,
        avgVolume: next.avgVolume,
        dayChangePercent: next.dayChangePercent,
      };
    }
    return next;
  });
}
