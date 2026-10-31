import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/server/lib/current-user";
import { errorResponse } from "@/server/lib/api-response";
import { removeSymbolFromWatchlist } from "@/server/modules/watchlist";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: { id: string; itemId: string };
}

// DELETE /api/watchlists/:id/items/:itemId — remove a symbol from a watchlist.
export async function DELETE(_req: Request, { params }: RouteParams) {
  try {
    const userId = await getAuthenticatedUserId();
    await removeSymbolFromWatchlist(userId, params.id, params.itemId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
