import { SlidingWindowRateLimiter } from "@/server/modules/market/rate-limiter";

// /api/chat can trigger paid LLM calls and several upstream requests per
// message, and the app has no real authentication, so each client gets a
// small per-minute budget. In-memory and per-process (same trade-off as the
// market-data limiter): enough to stop a runaway client or loop from
// draining the Groq / Twelve Data quotas, not a substitute for real
// auth or an edge rate limiter in production.

const WINDOW_MS = 60_000;
const MAX_TRACKED_CLIENTS = 5_000;
const limiters = new Map<string, SlidingWindowRateLimiter>();

// Prefers the first hop of x-forwarded-for (set by the platform proxy), then
// x-real-ip; "local" when neither exists (plain `next dev`).
export function clientKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "local";
}

export function allowChatRequest(key: string, limitPerMinute: number): boolean {
  let limiter = limiters.get(key);
  if (!limiter) {
    if (limiters.size >= MAX_TRACKED_CLIENTS) limiters.clear(); // bound memory
    limiter = new SlidingWindowRateLimiter(limitPerMinute, WINDOW_MS);
    limiters.set(key, limiter);
  }
  return limiter.tryAcquire();
}

export function resetChatRateLimits(): void {
  limiters.clear();
}
