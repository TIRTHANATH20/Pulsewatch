import { NextResponse } from "next/server";
import { errorResponse } from "@/server/lib/api-response";
import { getStockTopics } from "@/server/modules/nlp";

export const dynamic = "force-dynamic";

// GET /api/stocks/[symbol]/topics — the dominant topic(s) for a specific
// ticker's news, as opposed to /api/nlp/topics which returns the
// corpus-wide topic model. Routed through the shared nlpFetch client
// (server/modules/nlp/client.ts) so it respects NLP_FEATURE_ENABLED and
// maps network/timeout/schema failures to NlpUnavailableError the same
// way every other NLP route does.
export async function GET(
  _req: Request,
  { params }: { params: { symbol: string } },
) {
  try {
    const result = await getStockTopics(params.symbol);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
