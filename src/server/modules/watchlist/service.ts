import { prisma } from "@/server/db/prisma";
import { NotFoundError, DuplicateItemError } from "./errors";
import type {
  WatchlistSummary,
  WatchlistItemDTO,
  WatchlistDetail,
} from "@/types/watchlist";

// ---------------------------------------------------------------------------
// Mapping helpers — Prisma model shapes -> plain DTOs (see src/types/watchlist.ts)
// ---------------------------------------------------------------------------

type WatchlistWithItemIds = {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  items: { id: string }[];
};

function toSummary(watchlist: WatchlistWithItemIds): WatchlistSummary {
  return {
    id: watchlist.id,
    name: watchlist.name,
    itemCount: watchlist.items.length,
    createdAt: watchlist.createdAt.toISOString(),
    updatedAt: watchlist.updatedAt.toISOString(),
  };
}

function toItemDTO(item: {
  id: string;
  addedAt: Date;
  instrument: { symbol: string; name: string; exchange: string };
}): WatchlistItemDTO {
  return {
    id: item.id,
    symbol: item.instrument.symbol,
    name: item.instrument.name,
    exchange: item.instrument.exchange,
    addedAt: item.addedAt.toISOString(),
  };
}

// A Postgres unique-constraint violation, surfaced by Prisma as error code
// P2002. Checked structurally (rather than importing Prisma's error class)
// to keep this file's error handling simple and easy to unit test.
function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

// Confirms the watchlist exists AND belongs to this user in one query.
// Deliberately throws the same NotFoundError for "doesn't exist" and
// "belongs to someone else" — the caller should never be able to tell
// the difference between the two from the response.
async function requireOwnedWatchlist(userId: string, watchlistId: string) {
  const watchlist = await prisma.watchlist.findFirst({
    where: { id: watchlistId, userId },
  });
  if (!watchlist) {
    throw new NotFoundError("Watchlist not found");
  }
  return watchlist;
}

// ---------------------------------------------------------------------------
// Watchlist CRUD
// ---------------------------------------------------------------------------

export async function listWatchlists(
  userId: string,
): Promise<WatchlistSummary[]> {
  const watchlists = await prisma.watchlist.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: { items: { select: { id: true } } },
  });
  return watchlists.map(toSummary);
}

export async function createWatchlist(
  userId: string,
  name: string,
): Promise<WatchlistSummary> {
  const watchlist = await prisma.watchlist.create({
    data: { userId, name },
    include: { items: { select: { id: true } } },
  });
  return toSummary(watchlist);
}

export async function getWatchlist(
  userId: string,
  watchlistId: string,
): Promise<WatchlistDetail> {
  await requireOwnedWatchlist(userId, watchlistId);

  // Re-fetch with items included. Two queries (ownership check, then full
  // fetch) is a deliberate trade-off for readability/reuse of
  // requireOwnedWatchlist across every mutating operation below; the
  // watchlist table is small and this is not a hot path.
  const watchlist = await prisma.watchlist.findUniqueOrThrow({
    where: { id: watchlistId },
    include: {
      items: {
        orderBy: { addedAt: "asc" },
        include: { instrument: true },
      },
    },
  });

  return {
    id: watchlist.id,
    name: watchlist.name,
    itemCount: watchlist.items.length,
    createdAt: watchlist.createdAt.toISOString(),
    updatedAt: watchlist.updatedAt.toISOString(),
    items: watchlist.items.map(toItemDTO),
  };
}

export async function renameWatchlist(
  userId: string,
  watchlistId: string,
  name: string,
): Promise<WatchlistSummary> {
  await requireOwnedWatchlist(userId, watchlistId);
  const watchlist = await prisma.watchlist.update({
    where: { id: watchlistId },
    data: { name },
    include: { items: { select: { id: true } } },
  });
  return toSummary(watchlist);
}

export async function deleteWatchlist(
  userId: string,
  watchlistId: string,
): Promise<void> {
  await requireOwnedWatchlist(userId, watchlistId);
  // WatchlistItem rows cascade-delete via the schema's onDelete: Cascade;
  // Instrument rows are intentionally left alone (onDelete: Restrict on the
  // other side, and other watchlists/users may reference the same symbol).
  await prisma.watchlist.delete({ where: { id: watchlistId } });
}

// ---------------------------------------------------------------------------
// Watchlist items (symbols)
// ---------------------------------------------------------------------------

export async function addSymbolToWatchlist(
  userId: string,
  watchlistId: string,
  rawSymbol: string,
): Promise<WatchlistItemDTO> {
  await requireOwnedWatchlist(userId, watchlistId);
  const symbol = rawSymbol.trim().toUpperCase();

  // Adding a symbol here doesn't call the market-data provider directly —
  // that only happens when the attention/market modules fetch a quote for
  // it (see market/repository.ts:backfillInstrumentMetadata). So we upsert
  // a placeholder Instrument row keyed by symbol so the same symbol is
  // shared across watchlists/users rather than duplicated; the first
  // successful quote fetch backfills the real name/exchange onto this same
  // row (see DECISIONS.md #10), so this function's interface never needs
  // to change.
  const instrument = await prisma.instrument.upsert({
    where: { symbol },
    update: {},
    create: { symbol, name: symbol, exchange: "UNKNOWN" },
  });

  // A pre-check gives a friendlier error message in the common case; the
  // database's unique constraint on (watchlistId, instrumentId) remains the
  // actual source of truth and is what the catch block below guards
  // against, so this is safe under concurrent requests too.
  const existing = await prisma.watchlistItem.findFirst({
    where: { watchlistId, instrumentId: instrument.id },
  });
  if (existing) {
    throw new DuplicateItemError(`${symbol} is already on this watchlist`);
  }

  try {
    const item = await prisma.watchlistItem.create({
      data: { watchlistId, instrumentId: instrument.id },
      include: { instrument: true },
    });
    return toItemDTO(item);
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      throw new DuplicateItemError(`${symbol} is already on this watchlist`);
    }
    throw err;
  }
}

export async function removeSymbolFromWatchlist(
  userId: string,
  watchlistId: string,
  itemId: string,
): Promise<void> {
  await requireOwnedWatchlist(userId, watchlistId);

  const item = await prisma.watchlistItem.findFirst({
    where: { id: itemId, watchlistId },
  });
  if (!item) {
    throw new NotFoundError("Watchlist item not found");
  }

  await prisma.watchlistItem.delete({ where: { id: itemId } });
}
