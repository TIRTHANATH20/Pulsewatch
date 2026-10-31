// Shared attention DTO shapes — same convention as src/types/watchlist.ts:
// plain, JSON-serializable fields, no server-only imports, safe to import
// from both `src/server/modules/attention` (to type service return
// values) and client components (to type API responses).

export type AttentionStatus =
  | "NEW"
  | "UNCHANGED"
  | "CHANGED"
  | "SIGNIFICANT"
  | "STALE"
  | "UNAVAILABLE";

export interface AttentionItemDTO {
  itemId: string;
  watchlistId: string;
  watchlistName: string;
  symbol: string;
  name: string;
  exchange: string;
  status: AttentionStatus;
  previousPrice: number | null;
  currentPrice: number | null;
  absoluteChange: number | null;
  percentChange: number | null;
  attentionScore: number;
  reason: string;
  // ISO 8601, or null when status is UNAVAILABLE (no observation exists).
  // This is when PulseWatch FETCHED the price, not when it traded - see quoteTime.
  observedAt: string | null;
  // ISO 8601 of the provider's own trade/quote time, when it reports one.
  // On a closed market this can be hours or days before observedAt. Null for
  // STALE / UNAVAILABLE items and for providers that do not report a time.
  quoteTime: string | null;
  // How a fresh quote may honestly be described. Null when there is no fresh
  // quote (STALE / UNAVAILABLE).
  quoteKind: "live" | "delayed" | "simulated" | null;
  /** ISO 4217 currency code from the normalized market quote, when available. */
  currency: string | null;
  // Recent persisted PriceObservation history, oldest first — the real
  // data a sparkline is drawn from. Empty when no history exists yet.
  sparkline: number[];
  // Simulated-provider-only metadata (null for a real provider quote, or
  // any non-"fresh" outcome) — see market/types.ts's NormalizedQuote.
  volume: number | null;
  avgVolume: number | null;
  // Change vs the previous session close, in percent, when the provider
  // reported one for a fresh quote. Independent of the "since your last visit"
  // comparison above, which is 0.00% whenever nothing moved between visits.
  dayChangePercent?: number | null;
}

export interface AttentionResponse {
  items: AttentionItemDTO[];
  marketDataProvider: string;
}
