import { NextResponse } from "next/server";
import { getEnv } from "@/server/lib/env";
import { getAuthenticatedUserId } from "@/server/lib/current-user";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await getAuthenticatedUserId();
    const searchParams = new URL(req.url).searchParams;
    const exclude = searchParams.get("exclude") ?? "";
    const horizon = searchParams.get("horizon") ?? "short_term";
    const response = await fetch(
      `${getEnv().NLP_SERVICE_URL}/market/suggestions?exclude=${encodeURIComponent(exclude)}&horizon=${encodeURIComponent(horizon)}`,
      { cache: "no-store" },
    );
    const body = await response.json();
    return NextResponse.json(body, { status: response.status });
  } catch {
    return NextResponse.json({ error: "Dynamic suggestions are unavailable." }, { status: 502 });
  }
}
