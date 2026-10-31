import { NextResponse } from "next/server";
import { errorResponse } from "@/server/lib/api-response";
import { getRelatedNews } from "@/server/modules/nlp";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: { symbol: string } },
) {
  try {
    const { searchParams } = new URL(req.url);
    const articleId = searchParams.get("articleId") ?? undefined;
    const result = await getRelatedNews(params.symbol, articleId);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
