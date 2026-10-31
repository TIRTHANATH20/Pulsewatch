import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, readJsonBody } from "@/server/lib/api-response";
import { queryRag } from "@/server/modules/nlp";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  query: z.string().min(1, "query is required").max(2000),
  ticker: z.string().optional(),
});

// POST /api/rag/query — "Ask PulseWatch". Retrieval-augmented Q&A over
// the financial news corpus (project spec section 17). The NLP service
// does real vector retrieval (FAISS) before any generation step, and
// returns sources/evidence alongside the answer so the UI can render
// inspectable source cards rather than a bare LLM response.
export async function POST(req: Request) {
  try {
    const body = bodySchema.parse(await readJsonBody(req));
    const result = await queryRag(body.query, body.ticker);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
