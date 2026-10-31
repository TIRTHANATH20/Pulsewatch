import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allowChatRequest, clientKey, resetChatRateLimits } from "@/server/modules/chat/rate-limit";

describe("chat rate limit", () => {
  beforeEach(() => resetChatRateLimits());
  it("allows up to the limit per client then blocks, independently per client", () => {
    for (let i = 0; i < 3; i++) expect(allowChatRequest("1.1.1.1", 3)).toBe(true);
    expect(allowChatRequest("1.1.1.1", 3)).toBe(false);
    expect(allowChatRequest("2.2.2.2", 3)).toBe(true);
  });
  it("derives the client key from the first forwarded hop", () => {
    expect(clientKey(new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }))).toBe("9.9.9.9");
    expect(clientKey(new Headers({ "x-real-ip": "8.8.8.8" }))).toBe("8.8.8.8");
    expect(clientKey(new Headers())).toBe("local");
  });
});

describe("CHAT_RATE_LIMIT_PER_MINUTE env", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env = { ...originalEnv, DATABASE_URL: "postgresql://u:p@localhost:5432/db" };
    vi.resetModules();
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });
  it("defaults to 20", async () => {
    delete process.env.CHAT_RATE_LIMIT_PER_MINUTE;
    expect((await import("@/server/lib/env")).getEnv().CHAT_RATE_LIMIT_PER_MINUTE).toBe(20);
  });
  it("can be overridden", async () => {
    process.env.CHAT_RATE_LIMIT_PER_MINUTE = "5";
    expect((await import("@/server/lib/env")).getEnv().CHAT_RATE_LIMIT_PER_MINUTE).toBe(5);
  });
});
