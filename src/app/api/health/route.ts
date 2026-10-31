import { NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";

// A health endpoint that reports application liveness independently from
// database availability. This distinction matters for resilience: if the
// database is briefly unreachable, the app itself should still report as
// "up" with a degraded database status, rather than the whole health check
// failing and masking which dependency is actually the problem.
export async function GET() {
  const startedAt = Date.now();

  let database: "connected" | "unreachable" = "unreachable";
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = "connected";
  } catch {
    database = "unreachable";
  }

  return NextResponse.json(
    {
      status: "ok",
      database,
      timestamp: new Date().toISOString(),
      responseTimeMs: Date.now() - startedAt,
    },
    { status: 200 },
  );
}
