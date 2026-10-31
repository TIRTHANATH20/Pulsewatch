import { NextResponse } from "next/server";
import { errorResponse } from "@/server/lib/api-response";
import { getStockNlpIntelligence } from "@/server/modules/nlp";

export const dynamic = "force-dynamic";

// GET /api/stocks/[symbol]/nlp-intelligence — single aggregated call
// backing the dashboard's "NLP Intelligence" card for a tracked stock
// (sentiment, dominant topic, detected event, article summary, and the
// explainable news attention score). Kept as one endpoint rather than
// four separate client-side fetches so the card has a single
// loading/error state.
export async function GET(
  _req: Request,
  { params }: { params: { symbol: string } },
) {
  try {
    const result = await getStockNlpIntelligence(params.symbol);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
