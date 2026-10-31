import { SlidingWindowRateLimiter } from "@/server/modules/market/rate-limiter";

const WINDOW_MS = 60_000;
const MAX_TRACKED_CLIENTS = 5_000;
const limiters = new Map<string, SlidingWindowRateLimiter>();

export function allowAuthRequest(key: string, limitPerMinute = 10): boolean {
  let limiter = limiters.get(key);
  if (!limiter) {
    if (limiters.size >= MAX_TRACKED_CLIENTS) limiters.clear();
    limiter = new SlidingWindowRateLimiter(limitPerMinute, WINDOW_MS);
    limiters.set(key, limiter);
  }
  return limiter.tryAcquire();
}

export function resetAuthRateLimits(): void {
  limiters.clear();
}
