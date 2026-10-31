import { NextResponse } from "next/server";
import { getEnv } from "@/server/lib/env";
import { getAuthenticatedUserId } from "@/server/lib/current-user";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await getAuthenticatedUserId();
    const query = new URL(req.url).searchParams.get("q")?.trim() ?? "";
    if (query.length < 2 || query.length > 80) {
      return NextResponse.json({ error: "Search must be 2 to 80 characters." }, { status: 400 });
    }
    const response = await fetch(
      `${getEnv().NLP_SERVICE_URL}/market/search?q=${encodeURIComponent(query)}`,
      { cache: "no-store" },
    );
    const body = await response.json();
    return NextResponse.json(body, { status: response.status });
  } catch {
    return NextResponse.json({ error: "Company search is unavailable." }, { status: 502 });
  }
}
