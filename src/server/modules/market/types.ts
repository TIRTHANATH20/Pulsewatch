// Shared types for the market-data module. Kept separate from any single
// provider so `service.ts` and callers never depend on a provider-specific
// response shape — every provider implementation normalizes into
// `NormalizedQuote` at its own boundary.

export interface NormalizedQuote {
  symbol: string;
  price: number;
  currency?: string;
  exchange?: string;
  name?: string;
  observedAt: Date;
  // Optional trading-volume metadata. Not persisted to PriceObservation
  // (the schema has no volume column, and adding one is out of scope for
  // this pass — see DECISIONS.md) — only ever attached to a "fresh" read,
  // so a stale/fallback quote correctly has no volume figure rather than
  // a fabricated one.
  volume?: number;
  avgVolume?: number;
  // The provider's own quote/trade time and market-open flag, when it
  // reports them. `observedAt` stays the fetch time (the attention engine's
  // baselines rely on it); these two only drive how the quote is *labelled*.
  quoteTime?: Date;
  marketOpen?: boolean;
  // Previous session close, when the provider reports it. Lets the UI show a
  // real day change instead of only "since your last visit".
  previousClose?: number;
}

export interface HistoricalBar {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface MarketDataProvider {
  readonly name: string;
  fetchQuote(symbol: string, signal: AbortSignal): Promise<NormalizedQuote>;
  fetchHistory(symbol: string, range: HistoryRange, signal: AbortSignal): Promise<HistoricalBar[]>;
}

export type HistoryRange = "1D" | "1W" | "1M" | "3M" | "1Y";

// The result of asking the market module for a quote. This is the type
// consumers (the attention engine) actually work with — it already folds
// in the provider-failure/fallback decision so callers never see a raw
// provider error.
export type QuoteOutcome =
  | {
      status: "fresh";
      price: number;
      observedAt: Date;
      instrumentMeta?: InstrumentMeta;
      currency?: string;
      volume?: number;
      avgVolume?: number;
      quoteTime?: Date;
      marketOpen?: boolean;
      previousClose?: number;
    }
  | { status: "stale"; price: number; observedAt: Date; reason: string }
  | { status: "unavailable"; reason: string };

export interface InstrumentMeta {
  name?: string;
  exchange?: string;
}
