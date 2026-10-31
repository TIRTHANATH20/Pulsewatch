# RAG_ARCHITECTURE.md

## Pipeline

```
User Query (+ optional ticker filter)
    |
    v
Query Embedding            embeddings.get_default_embedder() — TF-IDF+SVD by
    |                       default in this build, transformer if installed
    v
FAISS Similarity Search    faiss.IndexFlatIP over L2-normalized vectors
    |                       = exact cosine similarity, brute-force (fine at
    |                       this corpus size; see "Scaling" below)
    v
Top-K Relevant Articles    over-fetch top_k*4, then filter by ticker if
    |                       requested, then truncate to top_k
    v
Relevance Threshold        results below MIN_RELEVANT_SIMILARITY (0.12) are
    |                       dropped — prevents "confidently answering" from
    |                       weak/irrelevant matches
    v
Context Construction       numbered [1], [2], ... article snippets with
    |                       date/source/ticker metadata
    v
LLM (optional)              only if GROQ_API_KEY is set on the NLP
    |                       service; strict system prompt (see below)
    v
Grounded Answer + Sources
```

Implementation: `nlp-service/app/pipeline/rag.py`. API:
`POST /rag/query` (NLP service) → proxied by Next.js `POST /api/rag/query`.

## Embeddings

Whatever `embeddings.get_default_embedder()` resolves to (see
NLP_ARCHITECTURE.md §7) — TF-IDF+SVD by default in this sandbox build,
sentence-transformers if the optional extras are installed. The choice
is reported in every RAG response's `embeddingMethod` field so it's
never ambiguous which representation produced a given answer.

## Vector database: FAISS

`faiss.IndexFlatIP` — an exact (not approximate) inner-product index
over L2-normalized vectors, which is mathematically equivalent to cosine
similarity ranking. Chosen per the project spec's preference for FAISS
as "lightweight and easy to demonstrate locally": no external server,
no persistence infrastructure required, rebuilds in milliseconds at this
corpus size.

**Scaling note**: `IndexFlatIP` is O(n) per query — fine for hundreds to
low thousands of articles. A production corpus would swap in
`IndexIVFFlat` or `IndexHNSWFlat` for approximate search, and persist the
index to disk with incremental updates instead of rebuilding on every
service restart (`get_index()` currently rebuilds from
`corpus.load_corpus()` each time the singleton is first accessed).

## Chunking

Articles in the sample corpus are short enough (1-3 sentences) to embed
whole (`article.full_text` = headline + body). A production corpus with
longer articles should chunk at the paragraph level before embedding —
noted here as a scaling consideration, not implemented, since the
shipped sample data doesn't need it.

## Retrieval & top-K selection

`NewsVectorIndex.search()`: embeds the query, normalizes it, searches
FAISS for `top_k * 4` candidates (to leave room for ticker filtering,
since `IndexFlatIP` has no native metadata filter), then keeps the first
`top_k` that match the requested ticker (if any).

## Context construction

`_build_context()`: each retrieved article becomes one numbered line —
`[n] (date, source, ticker) headline: body` — so the LLM (or the
templated fallback) can cite `[n]` markers traceably back to a specific
source card in the UI.

The unified `/api/chat` workflow requests retrieval only from this service
and forwards each retrieved document's text, headline, publisher, date, URL,
and ticker into the Financial Explanation Agent's evidence context. It does
not use the Python RAG endpoint's generated answer. When Yahoo supplies only
a headline, that headline is the available document text; PulseWatch does
not scrape full publisher pages.

## Generation & hallucination mitigation

System prompt (verbatim, `rag.py::SYSTEM_PROMPT`):

> You are PulseWatch's financial news assistant. Answer the user's
> question using ONLY the numbered context articles provided below.
> Cite articles by their [n] marker when you use them. If the context
> does not contain enough information to answer confidently, say
> explicitly: 'There is insufficient evidence in the retrieved articles
> to answer this.' Never invent an article, statistic, date, source, or
> quotation that is not in the context.

Two enforcement layers, not just prompt wording:

1. **Retrieval gate**: if no article clears `MIN_RELEVANT_SIMILARITY`,
   the function returns the fixed "insufficient evidence" string
   *without ever calling the LLM* — no amount of prompt-following is
   needed because there's nothing to hallucinate from.
2. **No-LLM fallback**: if `GROQ_API_KEY` isn't set (or the call
   fails for any reason), `_templated_extractive_answer()` builds the
   answer by string-concatenating retrieved headlines/metadata — zero
   generation, so zero hallucination risk, by construction.

## Source attribution

Every response includes `sources` / `retrievedDocuments`: article id,
headline, source, date, ticker, similarity score, and (as a bonus,
computed live) sentiment + category for that article — letting the UI
render inspectable "source cards" (see `src/app/news/page.tsx`'s
"Sources" section in the PulseWatch AI chat) rather than a bare paragraph
of prose.
Responses over the explicitly configured bundled sample corpus are
prefixed with a sample-data note; custom-corpus answers disclose that
source provenance has not been independently verified.

## Filtering by NLP metadata

`answer_query(query, ticker=...)` already supports ticker filtering.
The retrieved articles' `sentiment`/`category` fields (computed via the
existing classical sentiment/classification models, not a separate
system) are available on every source, so a future UI iteration could
add topic/event/date filters using the exact same retrieved-document
metadata without any new backend work.

## Evaluation

`nlp-service/tests/test_pipeline.py` includes:

- `test_rag_retrieves_relevant_ticker_specific_articles` — **retrieval
  relevance**: asserts every returned source actually matches the
  requested ticker and similarity is non-trivial.
- `test_rag_returns_insufficient_evidence_for_irrelevant_query` —
  **answer faithfulness**: an off-topic query ("capital of France")
  against a finance corpus must not fabricate an answer.

Suggested additional evaluation (not automated in this build, since it
needs either human judgment or a labeled QA set):

- **Retrieval relevance**: for a set of (query, expected article ids)
  pairs, measure recall@k of the FAISS search.
- **Answer faithfulness**: for LLM-generated answers, check that every
  `[n]` citation in the answer text corresponds to a real retrieved
  source (regex-extractable and checkable against `sources`).
- **Source correctness**: spot-check that cited articles actually
  support the specific claim attributed to them.
