import type { AttentionStatus } from "@/types/attention";
import { DELAYED_AFTER_MS } from "@/server/modules/market/quote-kind";

// Shared display-formatting helpers. Pulled out in Iteration 4 so
// AttentionSection, WatchlistsDashboard, and WatchlistDetail all render
// prices/percentages/freshness identically instead of each component
// carrying its own slightly-different copy.

export function formatPrice(price: number | null): string {
  if (price === null) return "—";
  return price.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Currency fallback for common NSE symbols when a provider omits currency.
// Provider-supplied INR/USD values always take precedence.
const INR_SYMBOLS = new Set([
  "RELIANCE",
  "TCS",
  "INFY",
  "HDFCBANK",
  "ICICIBANK",
  "SBIN",
  "ITC",
  "BHARTIARTL",
  "LT",
  "MARUTI",
]);

export function currencySymbolFor(symbol: string, currency?: string | null): string {
  if (currency === "INR") return "₹";
  if (currency === "USD") return "$";
  return INR_SYMBOLS.has(symbol.toUpperCase()) ? "₹" : "$";
}

export function formatPriceWithCurrency(
  price: number | null,
  symbol: string,
  currency?: string | null,
): string {
  if (price === null) return "—";
  return `${currencySymbolFor(symbol, currency)}${formatPrice(price)}`;
}

export function formatVolume(volume: number | null): string | null {
  if (volume === null) return null;
  if (volume >= 1_000_000_000) return `${(volume / 1_000_000_000).toFixed(2)}B`;
  if (volume >= 1_000_000) return `${(volume / 1_000_000).toFixed(2)}M`;
  if (volume >= 1_000) return `${(volume / 1_000).toFixed(1)}K`;
  return `${volume}`;
}

export function formatPercent(pct: number | null): string | null {
  if (pct === null) return null;
  // A move too small to show at two decimals (e.g. -0.004) must read "0.00%",
  // not "-0.00%" / "+0.00%" - a signed zero looks like a calculation bug.
  const fixed = pct.toFixed(2);
  if (Number(fixed) === 0) return "0.00%";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${fixed}%`;
}

// The percentage to show for "how much has this moved". Prefers the real
// since-last-visit move; when that is 0.00% (nothing changed between visits,
// or the price shown is only a last-known/STALE one) it falls back to the
// provider's change vs the previous close. A STALE price with no day change is
// reported as null (rendered "—"), never as a misleading 0.00%.
export function moveForDisplay(item: {
  percentChange: number | null;
  dayChangePercent?: number | null;
  status: AttentionStatus;
}): number | null {
  const visit = item.percentChange;
  if (visit !== null && item.status !== "STALE" && Math.abs(visit) >= 0.005) return visit;
  if (item.dayChangePercent !== null && item.dayChangePercent !== undefined) return item.dayChangePercent;
  if (item.status === "STALE") return null;
  return visit;
}

// "just now" | "N min" | "N hr" | "N days" - a bare duration, no "ago".
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hr`;
  return `${Math.round(hours / 24)} days`;
}

// How long ago the provider's own trade/quote time was, and whether that is
// old enough that the price must not be presented as "as of just now".
// `observedAt` is only when WE fetched the quote; on a closed market (nights,
// weekends, holidays) a quote fetched this second can be a day old.
function quoteAgeMs(quoteTime: string | null | undefined): number | null {
  if (!quoteTime) return null;
  const t = new Date(quoteTime).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Date.now() - t);
}

export function formatFreshness(
  observedAt: string | null,
  status: AttentionStatus,
  quoteTime?: string | null,
): string {
  if (status === "UNAVAILABLE") return "No data available";
  if (!observedAt) return "";
  const ms = Date.now() - new Date(observedAt).getTime();
  const minutes = Math.max(0, Math.round(ms / 60000));
  const age =
    minutes < 1
      ? "just now"
      : minutes === 1
        ? "1 min ago"
        : minutes < 60
          ? `${minutes} min ago`
          : `${Math.round(minutes / 60)} hr ago`;
  if (status === "STALE") return `Last known price · ${age}`;
  const tradeAge = quoteAgeMs(quoteTime);
  if (tradeAge !== null && tradeAge > DELAYED_AFTER_MS) {
    return `Last trade ${formatDuration(tradeAge)} ago`;
  }
  return `As of ${age}`;
}

// Short freshness label for compact contexts (watchlist item rows),
// where the fuller "Last known price · N min ago" phrasing would wrap
// awkwardly next to a price and a badge.
export function formatFreshnessShort(
  observedAt: string | null,
  status: AttentionStatus,
  quoteTime?: string | null,
): string {
  if (status === "UNAVAILABLE") return "No data";
  if (!observedAt) return "";
  const tradeAge = status === "STALE" ? null : quoteAgeMs(quoteTime);
  if (tradeAge !== null && tradeAge > DELAYED_AFTER_MS) {
    return `last trade ${formatDuration(tradeAge)} ago`;
  }
  const ms = Date.now() - new Date(observedAt).getTime();
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 min ago";
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} hr ago`;
}

export const STATUS_LABEL: Record<AttentionStatus, string> = {
  SIGNIFICANT: "Significant move",
  CHANGED: "Changed",
  NEW: "New",
  UNCHANGED: "No change",
  STALE: "Stale",
  UNAVAILABLE: "Unavailable",
};

export const STATUS_BADGE_CLASS: Record<AttentionStatus, string> = {
  SIGNIFICANT: "badge-significant",
  CHANGED: "badge-changed",
  NEW: "badge-new",
  UNCHANGED: "badge-unchanged",
  STALE: "badge-stale",
  UNAVAILABLE: "badge-unavailable",
};
