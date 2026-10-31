// A quote older than this is labelled "delayed" rather than "live".
export const DELAYED_AFTER_MS = 20 * 60 * 1000;

export interface QuoteLabelInput {
  providerName: string;
  // When the quote was fetched (always known).
  observedAt: Date;
  // The provider's own trade/quote time, when it reports one.
  quoteTime?: Date;
  // The provider's own "market is open" flag, when it reports one.
  marketOpen?: boolean;
  now: Date;
}

export interface QuoteLabel {
  kind: "live" | "delayed" | "simulated";
  asOf: Date;
  note: string;
}

// Decides how a *successful* provider quote may be described. Fetching a
// quote "just now" does not make it live: a closed market returns the last
// trade, which can be hours or days old, so the label depends on the
// provider's own quote time / market-open flag when those are available.
export function labelQuote(q: QuoteLabelInput): QuoteLabel {
  if (q.providerName.toLowerCase().includes("simulated")) {
    return { kind: "simulated", asOf: q.observedAt, note: "Simulated demo data, not a real market feed." };
  }
  const asOf = q.quoteTime ?? q.observedAt;
  const ageMs = Math.max(0, q.now.getTime() - asOf.getTime());
  if (q.marketOpen === false) {
    return {
      kind: "delayed",
      asOf,
      note: `Market is closed; this is the last traded price (quote time ${asOf.toISOString()}), not a live price.`,
    };
  }
  if (ageMs > DELAYED_AFTER_MS) {
    return { kind: "delayed", asOf, note: "Quote is older than 20 minutes." };
  }
  if (q.providerName.toLowerCase().includes("yfinance")) {
    return {
      kind: "delayed",
      asOf,
      note: "Yahoo Finance does not guarantee real-time exchange data; this quote may be delayed.",
    };
  }
  return {
    kind: "live",
    asOf,
    note: q.quoteTime ? "Quote time is within the last 20 minutes." : "Quote fetched from the provider just now (provider did not report a quote time).",
  };
}
