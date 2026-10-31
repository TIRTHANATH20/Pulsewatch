import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

// Tests the graceful-degradation contract of server/modules/nlp/client.ts
// in isolation, using a mocked global fetch — mirroring the "NLP must be
// optional / never crash the app" engineering rule from PROJECT_SPEC.md.

const BASE_ENV = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
};

describe("nlp client", () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv, ...BASE_ENV };
    return import("vitest").then(({ vi: v }) => v.resetModules());
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("throws NlpDisabledError when NLP_FEATURE_ENABLED=false, without calling fetch", async () => {
    process.env.NLP_FEATURE_ENABLED = "false";
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { getSentiment } = await import("@/server/modules/nlp/client");
    const { NlpDisabledError } = await import("@/server/modules/nlp/errors");

    await expect(getSentiment("test")).rejects.toBeInstanceOf(NlpDisabledError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws NlpUnavailableError when the service is unreachable", async () => {
    process.env.NLP_FEATURE_ENABLED = "true";
    global.fetch = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")) as unknown as typeof fetch;

    const { getSentiment } = await import("@/server/modules/nlp/client");
    const { NlpUnavailableError } = await import("@/server/modules/nlp/errors");

    await expect(getSentiment("test")).rejects.toBeInstanceOf(NlpUnavailableError);
  });

  it("throws NlpUnavailableError on a non-2xx response", async () => {
    process.env.NLP_FEATURE_ENABLED = "true";
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    const { getSentiment } = await import("@/server/modules/nlp/client");
    const { NlpUnavailableError } = await import("@/server/modules/nlp/errors");

    await expect(getSentiment("test")).rejects.toBeInstanceOf(NlpUnavailableError);
  });

  it("throws NlpUnavailableError when the response fails schema validation", async () => {
    process.env.NLP_FEATURE_ENABLED = "true";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ unexpected: "shape" }),
    }) as unknown as typeof fetch;

    const { getSentiment } = await import("@/server/modules/nlp/client");
    const { NlpUnavailableError } = await import("@/server/modules/nlp/errors");

    await expect(getSentiment("test")).rejects.toBeInstanceOf(NlpUnavailableError);
  });

  it("returns parsed data on a valid response", async () => {
    process.env.NLP_FEATURE_ENABLED = "true";
    const payload = {
      sentiment: "POSITIVE",
      confidence: 0.91,
      probabilities: { positive: 0.91, neutral: 0.06, negative: 0.03 },
      modelUsed: "classical-tfidf-logreg",
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => payload,
    }) as unknown as typeof fetch;

    const { getSentiment } = await import("@/server/modules/nlp/client");
    const result = await getSentiment("great earnings");
    expect(result).toEqual(payload);
  });

  it("queryRag returns a validated RagResult shape", async () => {
    process.env.NLP_FEATURE_ENABLED = "true";
    const payload = {
      answer: "There is insufficient evidence in the retrieved articles to answer this.",
      sources: [],
      retrievedDocuments: [],
      confidence: 0,
      generation: "none (no sufficiently relevant documents retrieved)",
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => payload,
    }) as unknown as typeof fetch;

    const { queryRag } = await import("@/server/modules/nlp/client");
    const result = await queryRag("unrelated question", "TCS");
    expect(result.sources).toEqual([]);
    expect(result.answer).toMatch(/insufficient evidence/i);
  });

  it("accepts the live news provenance returned by the NLP service", async () => {
    process.env.NLP_FEATURE_ENABLED = "true";
    const payload = { kind: "live", articleCount: 0 };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => payload,
    }) as unknown as typeof fetch;

    const { getCorpusInfo } = await import("@/server/modules/nlp/client");

    await expect(getCorpusInfo()).resolves.toEqual(payload);
  });
});
