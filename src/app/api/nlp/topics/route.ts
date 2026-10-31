import { NextResponse } from "next/server";
import { errorResponse } from "@/server/lib/api-response";
import { getCorpusTopics } from "@/server/modules/nlp";

export const dynamic = "force-dynamic";

// GET /api/nlp/topics?numTopics=5 — corpus-wide LDA topic discovery,
// used by the NLP pipeline and topic-analysis API.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const numTopics = Number(searchParams.get("numTopics") ?? "5");
    const result = await getCorpusTopics(
      Number.isFinite(numTopics) && numTopics > 0 ? numTopics : 5,
    );
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
