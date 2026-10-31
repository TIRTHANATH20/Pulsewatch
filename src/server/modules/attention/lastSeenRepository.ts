import { prisma } from "@/server/db/prisma";

export interface LastSeenSnapshot {
  price: number;
  observedAt: Date;
}

// Reads the baseline for (user, instrument). Returns null on first visit
// — the engine treats that as NEW, never as "unchanged from zero".
export async function getLastSeenState(
  userId: string,
  instrumentId: string,
  source: string,
): Promise<LastSeenSnapshot | null> {
  const row = await prisma.lastSeenState.findUnique({
    where: { userId_instrumentId: { userId, instrumentId } },
  });
  if (!row) {
    return null;
  }
  const observation = await prisma.priceObservation.findFirst({
    where: {
      instrumentId,
      observedAt: row.lastSeenObservedAt,
      source,
    },
    select: { id: true },
  });
  if (!observation) return null;
  return { price: Number(row.lastSeenPrice), observedAt: row.lastSeenObservedAt };
}

// A Postgres unique-constraint violation, surfaced by Prisma as error code
// P2002. Checked structurally rather than importing Prisma's error class —
// same pattern as watchlist/service.ts.
function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

// Establishes or advances the baseline. Callers must only invoke this
// AFTER computing the attention result for the current visit — never
// before, or the comparison would always read back the price it's about
// to be compared against (see attention/service.ts, and
// PulseWatch's explicit "read before updating" requirement).
//
// Concurrency note: two requests for the same (user, instrument) can
// interleave — e.g. a slow provider call for request A finishes after a
// faster one for request B that was issued moments later. A plain
// `upsert` would let whichever call happens to finish last win, even if
// its observation is actually older, silently moving the baseline
// backwards. To keep the baseline monotonic without any locking, the
// update is conditioned on this observation being at least as new as
// whatever is already stored; an older observation loses the race
// harmlessly instead of clobbering a newer baseline. This does not
// prevent two concurrent requests from both reading the same pre-update
// baseline and thus reporting the same "since last visit" delta once —
// that is an accepted, documented limitation (see DECISIONS.md), not a
// correctness bug: the baseline itself never regresses.
export async function upsertLastSeenState(
  userId: string,
  instrumentId: string,
  price: number,
  observedAt: Date,
): Promise<void> {
  const advanced = await prisma.lastSeenState.updateMany({
    where: {
      userId,
      instrumentId,
      lastSeenObservedAt: { lte: observedAt },
    },
    data: {
      lastSeenPrice: price,
      lastSeenObservedAt: observedAt,
    },
  });

  if (advanced.count > 0) {
    return;
  }

  // No row matched — either none exists yet, or the existing row is
  // already newer than this observation (in which case we deliberately
  // do nothing further). Try to create; if a row already exists (a
  // concurrent create won the race, or it's newer per the check above),
  // treat the unique-constraint violation as expected and move on.
  try {
    await prisma.lastSeenState.create({
      data: {
        userId,
        instrumentId,
        lastSeenPrice: price,
        lastSeenObservedAt: observedAt,
      },
    });
  } catch (err) {
    if (!isUniqueConstraintViolation(err)) {
      throw err;
    }
  }
}
