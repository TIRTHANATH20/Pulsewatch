import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, readJsonBody } from "@/server/lib/api-response";
import { analyzeText } from "@/server/modules/nlp";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  text: z.string().min(1, "text is required").max(20000),
});

// POST /api/nlp/analyze — runs the full NLP pipeline (preprocessing,
// sentiment, NER, classification, aspect sentiment, event extraction,
// keyphrases, similarity, embedding info) on arbitrary pasted text.
// Powers the "NLP Demo" page (project spec section 10) used to
// demonstrate every technology during a viva/presentation.
export async function POST(req: Request) {
  try {
    const body = bodySchema.parse(await readJsonBody(req));
    const result = await analyzeText(body.text);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
