import { z } from "zod";
import { getEnv } from "@/server/lib/env";
import { NlpDisabledError, NlpUnavailableError } from "./errors";
import type { ZodType } from "zod";
import {
  fullAnalysisSchema,
  sentimentResultSchema,
  entitiesResultSchema,
  categoryResultSchema,
  aspectSentimentSchema,
  eventResultSchema,
  summaryResultSchema,
  topicsResultSchema,
  attentionResultSchema,
  stockSentimentSchema,
  nlpIntelligenceSchema,
  ragResultSchema,
  type FullAnalysis,
  type NlpIntelligence,
  type RagResult,
  type StockSentiment,
  type AttentionResult,
  type TopicsResult,
} from "./types";

// The single low-level entry point every other function in this module
// goes through. Folds together: the feature flag, request timeout,
// non-2xx handling, and Zod validation of the response shape — mirroring
// how server/modules/market/service.ts centralizes provider-call
// concerns. Callers only ever see a parsed, typed result or one of the
// two domain errors in ./errors — never a raw fetch/parse exception.
async function nlpFetch<Schema extends ZodType>(
  path: string,
  schema: Schema,
  init?: RequestInit,
): Promise<z.infer<Schema>> {
  const env = getEnv();
  if (!env.NLP_FEATURE_ENABLED) {
    throw new NlpDisabledError();
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(
    () => controller.abort(),
    env.NLP_SERVICE_TIMEOUT_MS,
  );

  let res: Response;
  try {
    res = await fetch(`${env.NLP_SERVICE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      // Next.js's extended fetch() caches GET requests by default (its
      // "Data Cache"), which is wrong here: NLP results change as the
      // underlying corpus/models change, and every route calling this
      // client is already marked `export const dynamic = "force-dynamic"`
      // at the route-segment level — that setting does NOT, by itself,
      // stop this specific fetch() call from being cached, since that's
      // a separate caching layer. Without this, a request made once
      // could keep returning stale NLP output indefinitely, even across
      // restarts of the NLP service itself.
      cache: "no-store",
    });
  } catch (err) {
    // Covers connection refused (service not running), DNS failure, and
    // AbortError from the timeout above — all of these mean the same
    // thing to a caller: "NLP isn't reachable right now, degrade
    // gracefully" rather than "crash the request".
    throw new NlpUnavailableError(
      err instanceof Error && err.name === "AbortError"
        ? "NLP service timed out"
        : "Could not reach the NLP service",
    );
  } finally {
    clearTimeout(timeoutHandle);
  }

  if (!res.ok) {
    throw new NlpUnavailableError(
      `NLP service returned ${res.status} for ${path}`,
    );
  }

  const json = await res.json();
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new NlpUnavailableError(
      `NLP service response for ${path} did not match the expected shape`,
    );
  }
  return parsed.data;
}

export async function analyzeText(text: string): Promise<FullAnalysis> {
  return nlpFetch("/nlp/analyze", fullAnalysisSchema, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export async function getSentiment(text: string) {
  return nlpFetch("/nlp/sentiment", sentimentResultSchema, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export async function getEntities(text: string) {
  return nlpFetch("/nlp/entities", entitiesResultSchema, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export async function classifyText(text: string) {
  return nlpFetch("/nlp/classify", categoryResultSchema, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export async function getAspectSentiment(text: string) {
  return nlpFetch("/nlp/aspects", aspectSentimentSchema, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export async function getEvents(text: string) {
  return nlpFetch("/nlp/events", eventResultSchema, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export async function getSummary(text: string) {
  return nlpFetch("/nlp/summarize", summaryResultSchema, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export async function getCorpusTopics(numTopics = 5): Promise<TopicsResult> {
  return nlpFetch(`/nlp/topics?num_topics=${numTopics}`, topicsResultSchema);
}

export async function getStockNews(ticker: string) {
  return nlpFetch(
    `/stocks/${encodeURIComponent(ticker)}/news`,
    z.object({
      ticker: z.string(),
      count: z.number(),
      articles: z.array(
        z.object({
          id: z.string(),
          headline: z.string(),
          text: z.string(),
          date: z.string(),
          source: z.string(),
          ticker: z.string(),
          // Optional: only present when the corpus provides article URLs.
          url: z.string().nullish(),
        }),
      ),
    }),
  );
}

export async function getStockSentiment(ticker: string): Promise<StockSentiment> {
  return nlpFetch(`/stocks/${encodeURIComponent(ticker)}/sentiment`, stockSentimentSchema);
}

export async function getStockTopics(ticker: string) {
  return nlpFetch(
    `/stocks/${encodeURIComponent(ticker)}/topics`,
    z.object({
      ticker: z.string(),
      topics: z.array(
        z.object({ topicId: z.number(), label: z.string(), relevance: z.number() }),
      ),
      note: z.string().optional(),
    }),
  );
}

export async function getStockEvents(ticker: string) {
  return nlpFetch(
    `/stocks/${encodeURIComponent(ticker)}/events`,
    z.object({ ticker: z.string(), events: z.array(z.object({}).passthrough()) }),
  );
}

export async function getStockSummary(ticker: string) {
  return nlpFetch(
    `/stocks/${encodeURIComponent(ticker)}/summary`,
    z.object({ ticker: z.string(), summary: z.string().nullable() }).passthrough(),
  );
}

export async function getRelatedNews(ticker: string, articleId?: string) {
  const qs = articleId ? `?article_id=${encodeURIComponent(articleId)}` : "";
  return nlpFetch(
    `/stocks/${encodeURIComponent(ticker)}/related-news${qs}`,
    z.object({
      articleId: z.string(),
      related: z.array(z.object({ docId: z.string(), similarity: z.number() })),
    }),
  );
}

export async function getStockAttention(ticker: string): Promise<AttentionResult> {
  return nlpFetch(`/stocks/${encodeURIComponent(ticker)}/attention`, attentionResultSchema);
}

export async function getStockNlpIntelligence(ticker: string): Promise<NlpIntelligence> {
  return nlpFetch(`/stocks/${encodeURIComponent(ticker)}/nlp-intelligence`, nlpIntelligenceSchema);
}

// `generate: false` asks the service for retrieval only (no LLM call on the
// Python side). The chatbot uses this because its own Financial Explanation
// Agent writes the answer; otherwise every chat turn would pay for — and
// wait on — a second, discarded LLM call.
export async function queryRag(
  query: string,
  ticker?: string,
  topK = 5,
  opts: { generate?: boolean } = {},
): Promise<RagResult> {
  return nlpFetch("/rag/query", ragResultSchema, {
    method: "POST",
    body: JSON.stringify({ query, ticker, top_k: topK, generate: opts.generate ?? true }),
  });
}

// Reports whether ticker news comes from Yahoo Finance or a configured
// sample/custom corpus, so answers can disclose its provenance.
export async function getCorpusInfo() {
  return nlpFetch(
    "/corpus/info",
    z.object({ kind: z.enum(["live", "sample", "custom"]), articleCount: z.number() }),
  );
}

export async function checkNlpHealth(): Promise<{ status: string; service: string } | null> {
  try {
    return await nlpFetch(
      "/health",
      z.object({ status: z.string(), service: z.string() }),
    );
  } catch {
    return null;
  }
}
