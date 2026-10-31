import { prisma } from "@/server/db/prisma";
import type { NormalizedQuote } from "./types";

// Persists a successful provider read as an append-only PriceObservation
// row. Never updates or deletes existing rows — history is the whole
// point (see PROJECT_SPEC.md: "previous observed price" must be derived
// from stored history, never guessed).
export async function recordObservation(
  instrumentId: string,
  quote: NormalizedQuote,
  source: string,
) {
  return prisma.priceObservation.create({
    data: {
      instrumentId,
      price: quote.price,
      observedAt: quote.observedAt,
      source,
    },
  });
}

// The most recent stored observation for an instrument, if any. Used as
// the stale-fallback source when a live provider read fails.
export async function getLatestObservation(instrumentId: string, source: string) {
  return prisma.priceObservation.findFirst({
    where: { instrumentId, source },
    orderBy: { observedAt: "desc" },
  });
}

// The most recent N stored observations for an instrument, oldest first —
// the real, persisted history a sparkline is drawn from (never a
// fabricated shape). Used purely for display; not part of the attention
// engine's classification input.
export async function getRecentObservations(instrumentId: string, limit: number, source: string) {
  const rows = await prisma.priceObservation.findMany({
    where: { instrumentId, source },
    orderBy: { observedAt: "desc" },
    take: limit,
  });
  return rows.reverse();
}

// Backfills the placeholder Instrument metadata (`name = symbol`,
// `exchange = "UNKNOWN"`) left by the watchlist module when a symbol is
// first added (see DECISIONS.md #10 and the watchlist module's
// service.ts). Only writes when the provider actually returned better
// values than what's stored — never overwrites a previously-resolved
// name/exchange with a blank one just because a later read happened not
// to include it.
export async function backfillInstrumentMetadata(
  instrumentId: string,
  meta: { name?: string; exchange?: string },
): Promise<void> {
  if (!meta.name && !meta.exchange) {
    return;
  }
  const instrument = await prisma.instrument.findUnique({
    where: { id: instrumentId },
    select: { name: true, exchange: true, symbol: true },
  });
  if (!instrument) {
    return;
  }

  const data: { name?: string; exchange?: string } = {};
  if (meta.name && instrument.name === instrument.symbol) {
    // name still equals the placeholder value set at creation time
    data.name = meta.name;
  }
  if (meta.exchange && instrument.exchange === "UNKNOWN") {
    data.exchange = meta.exchange;
  }
  if (Object.keys(data).length === 0) {
    return;
  }

  await prisma.instrument.update({ where: { id: instrumentId }, data });
}
