import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/server/lib/current-user";
import { errorResponse, readJsonBody } from "@/server/lib/api-response";
import {
  getWatchlist,
  renameWatchlist,
  deleteWatchlist,
  renameWatchlistSchema,
} from "@/server/modules/watchlist";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: { id: string };
}

// GET /api/watchlists/:id — fetch one watchlist with its items.
export async function GET(_req: Request, { params }: RouteParams) {
  try {
    const userId = await getAuthenticatedUserId();
    const watchlist = await getWatchlist(userId, params.id);
    return NextResponse.json({ watchlist });
  } catch (err) {
    return errorResponse(err);
  }
}

// PATCH /api/watchlists/:id — rename a watchlist. Body: { name: string }
export async function PATCH(req: Request, { params }: RouteParams) {
  try {
    const userId = await getAuthenticatedUserId();
    const body = await readJsonBody(req);
    const { name } = renameWatchlistSchema.parse(body);
    const watchlist = await renameWatchlist(userId, params.id, name);
    return NextResponse.json({ watchlist });
  } catch (err) {
    return errorResponse(err);
  }
}

// DELETE /api/watchlists/:id — delete a watchlist and all its items.
export async function DELETE(_req: Request, { params }: RouteParams) {
  try {
    const userId = await getAuthenticatedUserId();
    await deleteWatchlist(userId, params.id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
