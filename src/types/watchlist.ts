// Shared watchlist DTO shapes.
//
// These are intentionally decoupled from the Prisma models: they contain
// only plain, JSON-serializable fields. This file has no server-only
// imports (no Prisma, no Node APIs), so it is safe to import from both
// `src/server/*` (to type service return values) and client components
// (to type API responses) without pulling server code into the browser
// bundle.

export interface WatchlistSummary {
  id: string;
  name: string;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WatchlistItemDTO {
  id: string;
  symbol: string;
  // Placeholder ("name === symbol", exchange "UNKNOWN") until the first
  // successful market-data quote backfills the real instrument details
  // (see market/repository.ts:backfillInstrumentMetadata, DECISIONS.md #10).
  name: string;
  exchange: string;
  addedAt: string;
}

export interface WatchlistDetail extends WatchlistSummary {
  items: WatchlistItemDTO[];
}
