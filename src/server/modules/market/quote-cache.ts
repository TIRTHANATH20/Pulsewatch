import type { NormalizedQuote } from "./types";

interface Entry {
  quote: NormalizedQuote;
  storedAt: number;
}

const MAX_ENTRIES = 500;

// A tiny in-process cache of the most recent *successful* provider quote per
// (provider, symbol). It only exists so the app's own background polling does
// not exhaust the provider rate limit. Quotes are not user-specific, so one
// entry safely serves every user.
//
// A cache hit returns the quote exactly as it was fetched, including its
// original `observedAt`, so freshness labels stay honest and no new
// PriceObservation is written for a quote that was not freshly fetched.
export class QuoteCache {
  private readonly entries = new Map<string, Entry>();

  get(key: string, maxAgeMs: number, now: number = Date.now()): NormalizedQuote | undefined {
    if (maxAgeMs <= 0) return undefined;
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (now - entry.storedAt >= maxAgeMs) return undefined;
    return entry.quote;
  }

  set(key: string, quote: NormalizedQuote, now: number = Date.now()): void {
    this.entries.delete(key);
    this.entries.set(key, { quote, storedAt: now });
    if (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

export const quoteCache = new QuoteCache();

export function quoteCacheKey(providerName: string, symbol: string): string {
  return `${providerName}:${symbol.trim().toUpperCase()}`;
}
