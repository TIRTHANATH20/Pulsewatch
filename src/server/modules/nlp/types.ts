import { z } from "zod";

// These schemas intentionally mirror the FastAPI response shapes in
// nlp-service/app/schemas.py and the pipeline modules' output dicts.
// Validating at the boundary means a change on the Python side that
// breaks the contract fails loudly and immediately (a 502-style error
// from the route), instead of silently propagating malformed data into
// the React UI.

export const preprocessResultSchema = z.object({
  original: z.string(),
  normalized: z.string(),
  tokens: z.array(z.string()),
  lemmas: z.array(z.string()),
  tokensNoStopwords: z.array(z.string()),
  tickers: z.array(z.string()),
  moneyMentions: z.array(z.string()),
  percentMentions: z.array(z.string()),
});

export const sentimentResultSchema = z.object({
  sentiment: z.enum(["POSITIVE", "NEUTRAL", "NEGATIVE"]),
  confidence: z.number(),
  probabilities: z.record(z.string(), z.number()),
  modelUsed: z.string(),
});

export const entitySchema = z.object({
  text: z.string().default(""),
  label: z.string(),
  normalized: z.string().optional(),
});

export const entitiesResultSchema = z.object({
  engine: z.string(),
  entities: z.array(entitySchema),
});

export const categoryResultSchema = z.object({
  category: z.string(),
  confidence: z.number(),
  method: z.string(),
  modelProbabilities: z.record(z.string(), z.number()),
  note: z.string().optional(),
});

export const aspectSentimentSchema = z.object({
  text: z.string(),
  aspectSentiments: z.array(
    z.object({
      aspect: z.string(),
      clause: z.string(),
      sentiment: z.string(),
      confidence: z.number(),
    }),
  ),
  method: z.string(),
});

export const eventResultSchema = z.object({
  eventDetected: z.boolean(),
  events: z.array(
    z.object({
      eventType: z.string(),
      triggerWord: z.string(),
      actor: z.string().nullable(),
      target: z.string().nullable(),
      value: z.string().nullable(),
      supportingEntities: z.array(entitySchema).optional(),
    }),
  ),
  note: z.string().optional(),
  method: z.string().optional(),
});

export const summaryResultSchema = z.object({
  summary: z.string(),
  method: z.string(),
  sentencesUsed: z.array(z.string()).optional(),
  totalSentences: z.number().optional(),
});

export const keyphraseSchema = z.object({
  phrase: z.string(),
  score: z.number(),
});

export const topicSchema = z.object({
  topicId: z.number(),
  label: z.string(),
  topWords: z.array(z.object({ term: z.string(), weight: z.number() })),
  articleCount: z.number(),
});

export const topicsResultSchema = z.object({
  numTopics: z.number(),
  topics: z.array(topicSchema),
  docTopics: z.record(z.string(), z.array(
    z.object({ topicId: z.number(), label: z.string(), relevance: z.number() }),
  )).optional(),
});

export const attentionResultSchema = z.object({
  newsAttentionScore: z.number(),
  maxScore: z.number(),
  reasons: z.array(z.string()),
  articleCount: z.number(),
  components: z.record(z.string(), z.number()).optional(),
  weights: z.record(z.string(), z.number()).optional(),
  detectedEvents: z.array(z.string()).optional(),
  embeddingMethod: z.string().optional(),
});

export const stockSentimentSchema = z.object({
  ticker: z.string(),
  articleCount: z.number(),
  overallSentiment: z.string().nullable(),
  distribution: z.object({ positive: z.number(), neutral: z.number(), negative: z.number() }).optional(),
  avgConfidence: z.number().optional(),
  perArticle: z
    .array(
      z.object({
        articleId: z.string(),
        headline: z.string(),
        sentiment: z.string(),
        confidence: z.number(),
      }).passthrough(),
    )
    .optional(),
});

export const nlpIntelligenceSchema = z.object({
  ticker: z.string(),
  sentiment: stockSentimentSchema,
  topics: z.array(z.object({ topicId: z.number(), label: z.string(), relevance: z.number() })),
  events: z.array(z.object({}).passthrough()),
  summary: z.string().nullable(),
  attention: attentionResultSchema,
});

export const ragSourceSchema = z.object({
  rank: z.number(),
  articleId: z.string(),
  headline: z.string(),
  text: z.string(),
  source: z.string(),
  date: z.string(),
  ticker: z.string(),
  url: z.string().nullish(),
  similarity: z.number(),
  sentiment: z.string(),
  category: z.string(),
});

export const ragResultSchema = z.object({
  answer: z.string(),
  sources: z.array(ragSourceSchema),
  retrievedDocuments: z.array(ragSourceSchema),
  confidence: z.number(),
  generation: z.string(),
  embeddingMethod: z.string().optional(),
});

export const fullAnalysisSchema = z.object({
  preprocessing: preprocessResultSchema,
  sentiment: sentimentResultSchema,
  entities: entitiesResultSchema,
  category: categoryResultSchema,
  aspectSentiment: aspectSentimentSchema,
  event: eventResultSchema,
  keyphrases: z.array(keyphraseSchema),
  similarArticles: z.array(z.object({ docId: z.string(), similarity: z.number() })),
  embeddingInfo: z.object({ method: z.string(), dimension: z.number() }),
});

export type FullAnalysis = z.infer<typeof fullAnalysisSchema>;
export type NlpIntelligence = z.infer<typeof nlpIntelligenceSchema>;
export type RagResult = z.infer<typeof ragResultSchema>;
export type StockSentiment = z.infer<typeof stockSentimentSchema>;
export type AttentionResult = z.infer<typeof attentionResultSchema>;
export type TopicsResult = z.infer<typeof topicsResultSchema>;
