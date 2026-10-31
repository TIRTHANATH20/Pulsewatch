import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/server/lib/current-user";
import { errorResponse, readJsonBody } from "@/server/lib/api-response";
import {
  addSymbolToWatchlist,
  addSymbolSchema,
} from "@/server/modules/watchlist";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: { id: string };
}

// POST /api/watchlists/:id/items — add a symbol to a watchlist.
// Body: { symbol: string }
// 409 Conflict if the symbol is already on this watchlist.
export async function POST(req: Request, { params }: RouteParams) {
  try {
    const userId = await getAuthenticatedUserId();
    const body = await readJsonBody(req);
    const { symbol } = addSymbolSchema.parse(body);
    const item = await addSymbolToWatchlist(userId, params.id, symbol);
    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
