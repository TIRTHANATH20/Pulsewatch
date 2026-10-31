import { z } from "zod";

// A watchlist name: required, trimmed, bounded length so the UI (and
// database column) never has to deal with unbounded or whitespace-only
// input.
export const watchlistNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(80, "Name must be 80 characters or fewer");

export const createWatchlistSchema = z.object({
  name: watchlistNameSchema,
});

export const renameWatchlistSchema = z.object({
  name: watchlistNameSchema,
});

// Symbols are validated permissively (letters, numbers, '.' and '-') so
// common formats like "BRK.B" or "RELIANCE-EQ" are accepted, without
// asserting the symbol is real — that check belongs to the market-data
// module in a later iteration, not here.
export const addSymbolSchema = z.object({
  symbol: z
    .string()
    .trim()
    .min(1, "Symbol is required")
    .max(20, "Symbol must be 20 characters or fewer")
    .regex(
      /^[A-Za-z0-9.\-]+$/,
      "Symbol may only contain letters, numbers, '.' and '-'",
    ),
});
