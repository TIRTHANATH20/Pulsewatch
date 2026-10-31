import { NextResponse } from "next/server";
import { errorResponse } from "@/server/lib/api-response";
import { getCurrentUser } from "@/server/lib/current-user";

export const dynamic = "force-dynamic";

// GET /api/auth/me — return the user attached to a valid, unexpired
// server-side session, or null.
export async function GET() {
  try {
    const user = await getCurrentUser();
    return NextResponse.json({ user });
  } catch (err) {
    return errorResponse(err);
  }
}
