import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/server/lib/current-user";
import { errorResponse } from "@/server/lib/api-response";
import { getAttentionForUser } from "@/server/modules/attention";
import { getMarketDataProvider } from "@/server/modules/market/provider-factory";

export const dynamic = "force-dynamic";

// GET /api/attention — "since your last visit" state for the current
// user's instruments. Optional ?watchlistId= scopes the response to one
// watchlist; omitted, it covers every watchlist the user owns.
//
// Ownership: getAttentionForUser only ever reads watchlists whose userId
// matches the resolved current user (see attention/service.ts). A
// watchlistId belonging to someone else, or one that doesn't exist,
// yields an empty `items` array rather than an error — the same
// don't-leak-existence pattern the watchlist module uses (see
// DECISIONS.md #8).
//
// Partial market-data failures for individual instruments are handled
// inside getAttentionForUser (each instrument is evaluated
// independently), so a single provider hiccup never fails this whole
// response.
export async function GET(req: Request) {
  try {
    const userId = await getAuthenticatedUserId();
    const { searchParams } = new URL(req.url);
    const watchlistId = searchParams.get("watchlistId") ?? undefined;
    // ?poll=1 marks the silent background refresh: it reads the baseline but
    // never advances it. Anything else is a user-initiated visit.
    const kind = searchParams.get("poll") === "1" ? "poll" : "visit";
    const items = await getAttentionForUser(userId, watchlistId, { kind });
    return NextResponse.json({
      items,
      marketDataProvider: getMarketDataProvider().name,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
