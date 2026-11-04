import { NextResponse } from "next/server";
import { getEnv } from "@/server/lib/env";
import { getAuthenticatedUserId } from "@/server/lib/current-user";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: { ticker: string } },
) {
  try {
    await getAuthenticatedUserId();
    const purpose = new URL(req.url).searchParams.get("purpose") ?? "holding";
    const horizon = new URL(req.url).searchParams.get("horizon") ?? "short_term";
    const response = await fetch(
      `${getEnv().NLP_SERVICE_URL}/market/${encodeURIComponent(params.ticker)}/insight?purpose=${encodeURIComponent(purpose)}&horizon=${encodeURIComponent(horizon)}`,
      { cache: "no-store" },
    );
    const body = await response.json();
    return NextResponse.json(body, { status: response.status });
  } catch {
    return NextResponse.json({ error: "Market insight is unavailable." }, { status: 502 });
  }
}
