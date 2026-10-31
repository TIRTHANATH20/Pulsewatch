import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, readJsonBody } from "@/server/lib/api-response";
import { registerWithEmail } from "@/server/lib/current-user";
import { allowAuthRequest } from "@/server/modules/auth/rate-limit";
import { clientKey } from "@/server/modules/chat/rate-limit";

const signupSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email is required")
    .email("Enter a valid email"),
  password: z
    .string()
    .min(4, "Password must be at least 4 characters")
    .max(256),
});

export async function POST(req: Request) {
  if (!allowAuthRequest(`signup:${clientKey(req.headers)}`, 5)) {
    return NextResponse.json(
      {
        error: "RateLimited",
        message: "Too many signup attempts. Please wait a minute.",
      },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }
  try {
    const body = await readJsonBody(req);
    const { email, password } = signupSchema.parse(body);
    const user = await registerWithEmail(email, password);
    return NextResponse.json({ user }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
