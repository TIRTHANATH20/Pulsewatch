import { z } from "zod";

// Contract for the single PulseWatch AI chatbot. Every assistant turn is
// produced by the Python LangGraph workflow and validated against
// `chatResponseSchema` before it leaves the server, so the UI never has to
// guess at the shape — and a malformed agent result fails loudly instead of
// rendering a false "Completed" badge.

export const AGENT_IDS = [
  "market_context",
  "news_research",
  "nlp_analysis",
  "evidence_rag",
  "explanation",
  "verification",
] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export const AGENT_META: Record<AgentId, { name: string; description: string; progress: string }> = {
  market_context: {
    name: "Market Context Agent",
    description: "Retrieves stock quotes, price history, timestamps and data freshness.",
    progress: "Retrieving market context",
  },
  news_research: {
    name: "Financial News Research Agent",
    description: "Retrieves ticker-related news, filters and de-duplicates it, and keeps source references.",
    progress: "Searching financial news",
  },
  nlp_analysis: {
    name: "NLP Analysis Agent",
    description: "Runs the project's NLP pipeline: sentiment, entities, topics, keyphrases and events.",
    progress: "Analyzing news with NLP",
  },
  evidence_rag: {
    name: "Evidence Retrieval & RAG Agent",
    description: "Retrieves supporting evidence from the indexed news using vector retrieval.",
    progress: "Retrieving supporting evidence",
  },
  explanation: {
    name: "Financial Explanation Agent",
    description: "Synthesizes one evidence-grounded answer from the other agents' outputs.",
    progress: "Generating the explanation",
  },
  verification: {
    name: "Verification Agent",
    description: "Checks citations, figures, timestamps, contradictions, causal claims and data freshness.",
    progress: "Verifying the answer",
  },
};

export const agentStatusSchema = z.enum(["completed", "skipped", "failed", "insufficient_evidence"]);
export type AgentStatus = z.infer<typeof agentStatusSchema>;

export const sourceRefSchema = z.object({
  // Citation marker used inside the answer text: "1", "2", … for articles
  // and "M1" for the market-data snapshot.
  ref: z.string(),
  type: z.enum(["article", "market"]),
  title: z.string(),
  url: z.string().nullable(),
  provider: z.string().nullable(),
  article_id: z.string().nullable(),
  published_at: z.string().nullable(),
  ticker: z.string().nullable(),
});
export type SourceRef = z.infer<typeof sourceRefSchema>;

export const agentResultSchema = z.object({
  agent_id: z.enum(AGENT_IDS),
  agent_name: z.string(),
  description: z.string(),
  status: agentStatusSchema,
  summary: z.string(),
  // Refs (see sourceRefSchema.ref) of the sources this agent touched.
  sources: z.array(z.string()),
  // Wall-clock duration measured around the real call; null when the agent
  // did not run (skipped), never an estimate.
  duration_ms: z.number().int().nonnegative().nullable(),
});
export type AgentResult = z.infer<typeof agentResultSchema>;

export const marketDataKindSchema = z.enum(["live", "delayed", "cached", "simulated", "unavailable"]);
export type MarketDataKind = z.infer<typeof marketDataKindSchema>;

export const dataFreshnessSchema = z.object({
  generated_at: z.string(),
  market: z.array(
    z.object({
      symbol: z.string(),
      data_type: marketDataKindSchema,
      provider: z.string().nullable(),
      as_of: z.string().nullable(),
      age_seconds: z.number().nullable(),
      note: z.string(),
    }),
  ),
  news: z
    .object({
      // "live" = ticker news fetched from Yahoo Finance, "custom" = a
      // corpus configured via NEWS_CORPUS_PATH, "sample" = explicitly
      // configured demo data, "unknown" = service did not report its source.
      corpus: z.enum(["live", "sample", "custom", "unknown"]),
      article_count: z.number().int().nonnegative(),
      newest_article_date: z.string().nullable(),
      oldest_article_date: z.string().nullable(),
      note: z.string(),
    })
    .nullable(),
});
export type DataFreshness = z.infer<typeof dataFreshnessSchema>;

export const verificationSchema = z.object({
  status: z.enum(["passed", "passed_with_warnings", "failed", "not_run"]),
  issues: z.array(
    z.object({
      severity: z.enum(["info", "warning", "error"]),
      code: z.string(),
      message: z.string(),
    }),
  ),
});
export type Verification = z.infer<typeof verificationSchema>;

export const generationSchema = z.object({
  mode: z.enum(["llm", "fallback", "none"]),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  // Why the fallback was used (e.g. "GROQ_API_KEY not configured").
  // Never contains secrets or raw provider payloads.
  reason: z.string().nullable(),
});
export type Generation = z.infer<typeof generationSchema>;

export const chatResponseSchema = z.object({
  conversation_id: z.string(),
  answer: z.string(),
  agents: z.array(agentResultSchema),
  sources: z.array(sourceRefSchema.extend({ cited: z.boolean() })),
  data_freshness: dataFreshnessSchema,
  verification: verificationSchema,
  generation: generationSchema,
  // Tickers resolved for this turn; the client sends them back as context
  // so follow-up questions ("and what about its news?") keep their subject.
  tickers: z.array(z.string()),
});
export type ChatResponse = z.infer<typeof chatResponseSchema>;

// Tickers flow from the (client-controlled) history into provider URLs and
// database lookups, so they are restricted to plain symbol characters.
export const tickerSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9.\-]{0,11}$/, "invalid ticker");

export const chatRequestSchema = z.object({
  message: z.string().trim().min(1, "message is required").max(2000),
  conversation_id: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9_-]+$/, "invalid conversation_id")
    .optional(),
  // One conversation, one history: the client owns the transcript and
  // sends the recent turns back so follow-ups retain context.
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(8000),
        tickers: z.array(tickerSchema).max(10).optional(),
      }),
    )
    .max(20)
    .default([]),
  stream: z.boolean().default(false),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

// Progress events are emitted from real execution points (an agent
// starting / finishing), never from timers.
export type ProgressEvent =
  | { type: "progress"; agent_id: AgentId; label: string; state: "running" | "done"; status?: AgentStatus }
  | { type: "result"; data: ChatResponse }
  | { type: "error"; message: string };

export function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
