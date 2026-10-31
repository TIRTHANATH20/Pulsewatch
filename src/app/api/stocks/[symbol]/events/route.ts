import { NextResponse } from "next/server";
import { errorResponse } from "@/server/lib/api-response";
import { getStockEvents } from "@/server/modules/nlp";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { symbol: string } },
) {
  try {
    const result = await getStockEvents(params.symbol);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
