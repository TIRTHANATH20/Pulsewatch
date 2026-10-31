import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/server/lib/current-user";
import { errorResponse, readJsonBody } from "@/server/lib/api-response";
import {
  createWatchlist,
  listWatchlists,
  createWatchlistSchema,
} from "@/server/modules/watchlist";

export const dynamic = "force-dynamic";

// GET /api/watchlists — list the current user's watchlists.
export async function GET() {
  try {
    const userId = await getAuthenticatedUserId();
    const watchlists = await listWatchlists(userId);
    return NextResponse.json({ watchlists });
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/watchlists — create a new watchlist. Body: { name: string }
export async function POST(req: Request) {
  try {
    const userId = await getAuthenticatedUserId();
    const body = await readJsonBody(req);
    const { name } = createWatchlistSchema.parse(body);
    const watchlist = await createWatchlist(userId, name);
    return NextResponse.json({ watchlist }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
