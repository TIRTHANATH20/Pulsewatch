import { NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import { errorResponse } from "@/server/lib/api-response";
import { getAuthenticatedUserId } from "@/server/lib/current-user";
import { getHistoricalBars } from "@/server/modules/market";
import type { HistoryRange } from "@/server/modules/market";

export const dynamic = "force-dynamic";
const ranges = new Set<HistoryRange>(["1D", "1W", "1M", "3M", "1Y"]);

export async function GET(req: Request) {
  try {
    const userId = await getAuthenticatedUserId();
    const url = new URL(req.url);
    const symbol = (url.searchParams.get("symbol") ?? "").trim().toUpperCase();
    const range = (url.searchParams.get("range") ?? "1M") as HistoryRange;
    if (!symbol || !ranges.has(range))
      return NextResponse.json(
        { error: "Invalid symbol or range" },
        { status: 400 },
      );
    const item = await prisma.watchlistItem.findFirst({
      where: { instrument: { symbol }, watchlist: { userId } },
      include: { instrument: true },
    });
    if (!item)
      return NextResponse.json(
        { error: "Instrument not found" },
        { status: 404 },
      );
    const result = await getHistoricalBars(
      { id: item.instrument.id, symbol },
      range,
    );
    return NextResponse.json({
      ...result,
      bars: result.bars.map((bar) => ({
        ...bar,
        timestamp: bar.timestamp.toISOString(),
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
