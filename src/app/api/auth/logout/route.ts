import { NextResponse } from "next/server";
import { errorResponse } from "@/server/lib/api-response";
import { clearCurrentUserCookie } from "@/server/lib/current-user";

// POST /api/auth/logout — revokes the current server-side session.
export async function POST() {
  try {
    await clearCurrentUserCookie();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
