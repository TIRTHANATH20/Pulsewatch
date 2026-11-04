import { z } from "zod";

// Centralized, validated access to environment variables. Importing this
// module anywhere throws a clear, early error if required configuration is
// missing or malformed, instead of failing later with a confusing runtime
// error deep in the database or fetch layer.
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  // --- Market data (Iteration 3, extended Iteration 4) ----------------
  // Which provider implementation the factory in
  // src/server/modules/market resolves. Stays an enum (not a free
  // string) so adding a provider is a type-checked switch, not a
  // typo-prone string compare.
  //
  // Yahoo Finance through the Python NLP service is the default; simulated
  // data remains available only when explicitly selected for demonstrations.
  MARKET_DATA_PROVIDER: z
    .enum(["simulated", "twelvedata", "yfinance"])
    .default("yfinance"),
  // Optional at the env-validation layer: a missing key should not crash
  // the whole app (watchlist CRUD doesn't need it), but the market module
  // throws a clear ProviderRequestError the moment a quote is actually
  // requested without one configured.
  TWELVE_DATA_API_KEY: z.string().optional(),
  // How long to wait for a single provider request before treating it as
  // failed and falling back to the last known observation.
  MARKET_DATA_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  // Quote and history requests per rolling 60s window before the in-memory
  // rate limiter starts short-circuiting to stale/unavailable data.
  // Twelve Data's free tier allows 8/min;
  // default is set just under that to leave headroom for the app's own
  // health checks and manual testing hitting the same key.
  MARKET_DATA_RATE_LIMIT_PER_MINUTE: z.coerce
    .number()
    .int()
    .positive()
    .default(7),

  // --- Attention engine (Iteration 3) --------------------------------
  // Minimum absolute percentage move (since the user's last-seen price)
  // to classify an instrument as CHANGED rather than UNCHANGED.
  ATTENTION_CHANGED_PCT: z.coerce.number().positive().default(0.5),
  // Minimum absolute percentage move to classify as SIGNIFICANT rather
  // than CHANGED. Must be >= ATTENTION_CHANGED_PCT; validated below.
  ATTENTION_SIGNIFICANT_PCT: z.coerce.number().positive().default(3),
  // Purely a display concern (used to phrase "last known price · N min
  // old" in the attention reason text) — has no effect on STALE
  // classification itself, which is driven by whether the market module's
  // live fetch succeeded, not by the age of the fallback observation.
  STALE_DISPLAY_ROUNDING_MINUTES: z.coerce.number().int().positive().default(1),

  // --- NLP intelligence --------------------------------------------------
  // Base URL of the standalone Python NLP service (see /nlp-service).
  // Defaults to the service's local dev port so `npm run dev` +
  // `uvicorn app.main:app` work together with zero extra config.
  NLP_SERVICE_URL: z.string().url().default("http://localhost:8000"),
  // How long to wait for the NLP service before treating this request as
  // unavailable and falling back gracefully (see server/modules/nlp/client.ts).
  // NLP calls can be slower than market-data calls (LDA/embeddings aren't
  // free), hence a higher default than MARKET_DATA_TIMEOUT_MS.
  NLP_SERVICE_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  // If "true", NLP intelligence sections are hidden/disabled app-wide
  // instead of attempting to reach the NLP service at all — useful for
  // running PulseWatch's core market-watchlist functionality with zero
  // Python dependency, per the project's "NLP must be optional" rule.
  NLP_FEATURE_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

  // --- PulseWatch AI chatbot (src/server/modules/chat) -----------------
  // LLM used by the Financial Explanation Agent. Optional: when the key
  // is absent (or the provider fails) the agent falls back to a
  // deterministic, evidence-only template and the response says so.
  GROQ_API_KEY: z.string().optional(),
  CHAT_LLM_MODEL: z.string().min(1).default("llama-3.3-70b-versatile"),
  CHAT_LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(25000),
  // Max /api/chat requests per client per minute (each can cost an LLM call).
  CHAT_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(20),
});

const validatedEnvSchema = envSchema.superRefine((env, ctx) => {
  if (env.ATTENTION_SIGNIFICANT_PCT < env.ATTENTION_CHANGED_PCT) {
    ctx.addIssue({
      code: "custom",
      message:
        "ATTENTION_SIGNIFICANT_PCT must be >= ATTENTION_CHANGED_PCT (a move can't be 'significant' at a smaller threshold than 'changed')",
      path: ["ATTENTION_SIGNIFICANT_PCT"],
    });
  }

  if (env.NODE_ENV === "production") {
    const appUrl = new URL(env.NEXT_PUBLIC_APP_URL);
    if (appUrl.protocol !== "https:" || isLoopbackHost(appUrl.hostname)) {
      ctx.addIssue({
        code: "custom",
        message:
          "Production NEXT_PUBLIC_APP_URL must use HTTPS and a non-localhost host",
        path: ["NEXT_PUBLIC_APP_URL"],
      });
    }
    const nlpUrl = new URL(env.NLP_SERVICE_URL);
    if (env.NLP_FEATURE_ENABLED && isLoopbackHost(nlpUrl.hostname)) {
      ctx.addIssue({
        code: "custom",
        message:
          "Production NLP_SERVICE_URL must point to a reachable non-loopback service",
        path: ["NLP_SERVICE_URL"],
      });
    }
  }
});

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "::1" || host.startsWith("127.");
}

export type Env = z.infer<typeof validatedEnvSchema>;

function loadEnv(): Env {
  const parsed = validatedEnvSchema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NODE_ENV: process.env.NODE_ENV,
    MARKET_DATA_PROVIDER: process.env.MARKET_DATA_PROVIDER,
    TWELVE_DATA_API_KEY: process.env.TWELVE_DATA_API_KEY,
    MARKET_DATA_TIMEOUT_MS: process.env.MARKET_DATA_TIMEOUT_MS,
    MARKET_DATA_RATE_LIMIT_PER_MINUTE:
      process.env.MARKET_DATA_RATE_LIMIT_PER_MINUTE,
    ATTENTION_CHANGED_PCT: process.env.ATTENTION_CHANGED_PCT,
    ATTENTION_SIGNIFICANT_PCT: process.env.ATTENTION_SIGNIFICANT_PCT,
    STALE_DISPLAY_ROUNDING_MINUTES: process.env.STALE_DISPLAY_ROUNDING_MINUTES,
    NLP_SERVICE_URL: process.env.NLP_SERVICE_URL,
    NLP_SERVICE_TIMEOUT_MS: process.env.NLP_SERVICE_TIMEOUT_MS,
    NLP_FEATURE_ENABLED: process.env.NLP_FEATURE_ENABLED,
    GROQ_API_KEY: process.env.GROQ_API_KEY || undefined,
    CHAT_LLM_MODEL: process.env.CHAT_LLM_MODEL || undefined,
    CHAT_LLM_TIMEOUT_MS: process.env.CHAT_LLM_TIMEOUT_MS || undefined,
    CHAT_RATE_LIMIT_PER_MINUTE:
      process.env.CHAT_RATE_LIMIT_PER_MINUTE || undefined,
  });

  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${message}`);
  }

  return parsed.data;
}

// Lazily validated so importing this module in a test environment without
// a DATABASE_URL doesn't crash test collection — call getEnv() only where
// the value is actually needed (e.g. inside request handlers).
let cached: Env | undefined;
export function getEnv(): Env {
  if (!cached) {
    cached = loadEnv();
  }
  return cached;
}
