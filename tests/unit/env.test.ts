import { describe, expect, it, beforeEach, afterEach } from "vitest";

describe("getEnv", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    // The module caches its parsed result internally; reset the module
    // registry so each test observes a fresh, uncached call to getEnv().
    return import("vitest").then(({ vi }) => vi.resetModules());
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws a clear error when DATABASE_URL is missing", async () => {
    delete process.env.DATABASE_URL;
    const { getEnv } = await import("@/server/lib/env");
    expect(() => getEnv()).toThrow(/DATABASE_URL/);
  });

  it("returns parsed config when DATABASE_URL is present", async () => {
    process.env.MARKET_DATA_PROVIDER = "yfinance";
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
    const { getEnv } = await import("@/server/lib/env");
    const env = getEnv();
    expect(env.DATABASE_URL).toBe("postgresql://user:pass@localhost:5432/db");
    expect(env.NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
    expect(env.MARKET_DATA_PROVIDER).toBe("yfinance");
    expect(env.CHAT_LLM_MODEL).toBe("llama-3.3-70b-versatile");
  });

  it("rejects a malformed NEXT_PUBLIC_APP_URL", async () => {
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
    process.env.NEXT_PUBLIC_APP_URL = "not-a-url";
    const { getEnv } = await import("@/server/lib/env");
    expect(() => getEnv()).toThrow(/NEXT_PUBLIC_APP_URL/);
  });

  it("rejects localhost production URLs instead of silently using development defaults", async () => {
    process.env.DATABASE_URL = "postgresql://localhost:5432/db";
    Reflect.set(process.env, "NODE_ENV", "production");
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    process.env.NLP_SERVICE_URL = "http://127.0.0.1:8000";
    const { getEnv } = await import("@/server/lib/env");
    expect(() => getEnv()).toThrow(/Production NEXT_PUBLIC_APP_URL/);
  });

  it("requires a reachable NLP service URL in production", async () => {
    process.env.DATABASE_URL = "postgresql://localhost:5432/db";
    Reflect.set(process.env, "NODE_ENV", "production");
    process.env.NEXT_PUBLIC_APP_URL = "https://pulsewatch.example";
    process.env.NLP_SERVICE_URL = "http://localhost:8000";
    const { getEnv } = await import("@/server/lib/env");
    expect(() => getEnv()).toThrow(/Production NLP_SERVICE_URL/);
  });
});
