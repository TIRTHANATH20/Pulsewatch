import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, readJsonBody } from "@/server/lib/api-response";
import { loginWithEmail } from "@/server/lib/current-user";
import { allowAuthRequest } from "@/server/modules/auth/rate-limit";
import { clientKey } from "@/server/modules/chat/rate-limit";

const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email is required")
    .email("Enter a valid email"),
  password: z.string().min(1, "Password is required").max(256),
});

export async function POST(req: Request) {
  if (!allowAuthRequest(`login:${clientKey(req.headers)}`, 10)) {
    return NextResponse.json(
      {
        error: "RateLimited",
        message: "Too many login attempts. Please wait a minute.",
      },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }
  try {
    const body = await readJsonBody(req);
    const { email, password } = loginSchema.parse(body);
    const user = await loginWithEmail(email, password);
    return NextResponse.json({ user }, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
