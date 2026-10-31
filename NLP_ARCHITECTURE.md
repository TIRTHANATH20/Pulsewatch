# NLP_ARCHITECTURE.md

## 1. Problem statement

PulseWatch's existing attention engine answers *"what meaningfully
changed since I last checked?"* using price data alone. It cannot answer
*"why?"*. This project adds a genuine NLP pipeline over financial news
so PulseWatch can explain price moves in terms of the news driving them,
and can surface news-only significance (e.g. a regulatory investigation)
that price data alone wouldn't catch yet.

## 2. Why NLP (not just an LLM call)

An LLM asked "what does this article mean?" produces plausible-sounding
prose with no guarantee of being grounded, reproducible, or explainable,
and teaches nothing about how the underlying techniques work. This
project instead implements each classical/ML/DL technique explicitly:
TF-IDF, Logistic Regression, LDA, Word2Vec, rule-based NER/event
extraction, TextRank summarization, embedding-based clustering, and
FAISS retrieval — with an LLM used ONLY as an optional, clearly-labeled
final generation step in RAG (see RAG_ARCHITECTURE.md), constrained to
answer solely from retrieved evidence.

## 2a. Methodology classification (what kind of NLP each component is)

To avoid any ambiguity about what's actually implemented, every
component is classified below. None of the rule-based components are
transformer-based or "AI-powered" in the deep-learning sense — they are
deterministic pattern/lexicon logic, labeled honestly as such.

| Component | Category | Notes |
|---|---|---|
| Preprocessing (tokenization, normalization) | Rule-based | Regex + curated lexicons, no statistical model |
| TF-IDF (keywords, keyphrases, similarity) | Classical/statistical | `sklearn.TfidfVectorizer` |
| Word2Vec embeddings | Classical ML (shallow neural) | `gensim.Word2Vec`, trained on the local corpus |
| TF-IDF + SVD (LSA) embeddings | Classical/statistical | Default dense embedding in this build |
| Sentence-transformer embeddings | Transformer-based | Optional, not installed by default |
| Sentiment — classical | Machine learning | Optional TF-IDF + Logistic Regression, enabled only with `SENTIMENT_DATASET_PATH`; otherwise FinBERT or an explicitly labeled rule-based lexicon |
| Sentiment — FinBERT | Transformer-based (deep learning) | Optional, not installed by default |
| Named Entity Recognition — default | Rule-based | Gazetteer + regex, fully deterministic |
| Named Entity Recognition — spaCy | Transformer/statistical (model-dependent) | Optional, not installed by default |
| Topic modeling (LDA) | Classical/statistical (probabilistic) | `gensim.LdaModel`, unsupervised |
| Topic modeling (BERTopic) | Transformer-based | Documented, not implemented in this build |
| News category classification | Machine learning / rule-based | Optional TF-IDF + Logistic Regression with `CLASSIFICATION_DATASET_PATH`; keyword rules are the default |
| Aspect-based sentiment | Rule-based + selected sentiment model | Clause-splitting is rule-based; each clause uses whichever sentiment implementation is configured |
| Event extraction | Rule-based | Trigger-word patterns + NER role assignment — explicitly **not** a trained model, and not an LLM call |
| Summarization | Classical/statistical (graph-based) | TextRank: TF-IDF sentence graph + PageRank centrality |
| Clustering | Classical/statistical | Agglomerative clustering over embeddings |
| Attention scoring | Rule-based (explicit weighted formula) | Combines the above signals; not learned, not a black box |
| RAG retrieval | Classical/statistical (vector search) | FAISS cosine similarity over TF-IDF+SVD or transformer embeddings |
| RAG generation | Transformer-based (LLM), optional | Only the final answer-writing step; retrieval never depends on it, and a non-LLM extractive fallback always works |

## 3. High-level architecture

```
Next.js application (existing PulseWatch)
        |
        | REST (fetch, Zod-validated) — src/server/modules/nlp/client.ts
        v
NLP service (Python, FastAPI) — /nlp-service
        |
        +-- preprocessing.py     finance-aware tokenization/normalization
        +-- tfidf.py             TF-IDF vectorization, keyphrases, similarity
        +-- sentiment.py         classical (TF-IDF+LogReg) + optional FinBERT
        +-- ner.py               rule-based gazetteer + optional spaCy
        +-- topics.py            LDA topic discovery
        +-- embeddings.py        Word2Vec, TF-IDF+SVD, optional transformer
        +-- classification.py    9-category news classifier
        +-- aspect_sentiment.py  clause-level ABSA
        +-- events.py            trigger-pattern + NER frame extraction
        +-- summarization.py     TextRank extractive summarization
        +-- clustering.py        agglomerative clustering over embeddings
        +-- attention.py         explainable news attention score
        +-- rag.py               FAISS retrieval + optional grounded generation
        |
        v
JSON results (Zod-validated on the Next.js side)
        |
        v
PulseWatch attention engine + UI
```

The Next.js app remains the primary frontend/backend, exactly as
required. The NLP service is a separate deployable unit reached over
plain HTTP, so PulseWatch's core watchlist functionality has zero Python
dependency and keeps working if the NLP service is down (see section 20,
Limitations, and `NLP_FEATURE_ENABLED` in `.env`).

**Persistence status:** every `/api/stocks/[symbol]/*` and
`/api/rag/query` route is a **live proxy** — it calls the NLP service on
every request and returns its response directly; nothing is written to
or read from Postgres. There is no Prisma model, migration, or
read/write path for NLP results in this build (no `NewsArticle`,
`NewsSentiment`, etc. exist in `prisma/schema.prisma`). Adding a real
cache (schema + migration + a write path in the API routes + a
read-through/staleness policy) is listed as a future improvement in
section 21 — it's a genuine, non-trivial
feature addition, not something to silently claim as already done.

## 4. Dataset

See DATASET_SETUP.md for how to add real datasets, and DATASETS.md for
exact provenance/fields/labels of the sample datasets shipped in this
repo. Small, hand-written sample datasets
(`nlp-service/data/sample_phrasebank.csv`, `sample_news_categories.csv`,
`sample_news.csv`) are retained for tests/evaluation, not loaded by
default in live requests. Ticker news comes from Yahoo Finance through
`yfinance`; corpus-wide news endpoints are empty unless an explicit
`NEWS_CORPUS_PATH` is supplied. See DATASETS.md for provenance and
DATASET_SETUP.md for configuring licensed training datasets.

## 5. Preprocessing

`nlp-service/app/pipeline/preprocessing.py`. Finance-aware: preserves
tickers (`$AAPL`), money (`$2 billion`, `₹3,421`), percentages (`4.2%`),
and financial acronyms (AI, IPO, EPS, Q4, EBITDA, ...) instead of
stripping them as generic stopwords/punctuation. Lemmatization is a
lightweight suffix-stripper; a spaCy lemmatizer is the documented
upgrade path when transformer extras are installed.

## 6. TF-IDF

`tfidf.py`. `TfidfVectorizer(ngram_range=(1,2))` over preprocessed text.
Powers keyword/keyphrase extraction (explainable top-N terms per
document), the classical sentiment/classification baselines' feature
representation, and one branch of document similarity.

## 7. Word embeddings

`embeddings.py`. Two classical representations are implemented for real:
- `Word2VecEmbedder`: gensim Word2Vec **trained on the corpus in this
  repo** (not a stub) — mean-pooled word vectors as document vectors.
  This class is implemented but is not selected by the current
  `get_default_embedder()` runtime path.
- `TfidfSvdEmbedder`: TF-IDF → TruncatedSVD (classic LSA), the default
  embedding backing RAG in this environment since it needs no model
  download. Transformer embeddings replace it only when optional models
  are installed.
`TransformerEmbedder` (sentence-transformers `all-MiniLM-L6-v2`) is the
documented modern counterpart — see NLP_SETUP.md for why it isn't
installed by default here and how to enable it locally.

## 8. Sentiment analysis

`sentiment.py`. `ClassicalSentimentModel` is TF-IDF + Logistic
Regression, trained only when `SENTIMENT_DATASET_PATH` is configured;
the bundled hand-written labels are used by offline evaluation/tests,
not loaded by live requests. `TransformerSentimentModel` wraps FinBERT
(`ProsusAI/finbert`) when `transformers`/`torch` and model weights are
available. The runtime preference is FinBERT, then an explicitly
configured classical model, then a rule-based lexicon. Each response
reports `modelUsed`.

## 9. Named Entity Recognition

`ner.py`. `RuleBasedNER` (gazetteer + regex) is always available and
fully deterministic/explainable. `SpacyNER` is used automatically if
`spacy` + `en_core_web_sm` are installed. Entities are normalized where
possible (e.g. "TCS" → "Tata Consultancy Services") so they can be
linked back to tracked `Instrument` rows.

## 10. Topic modeling

`topics.py`. Real gensim LDA; topics are **discovered from the corpus**,
not hardcoded, and given a best-effort human-readable label by matching
top words against a keyword lookup (display only — the underlying
topic-word distribution is what LDA actually learned). BERTopic is
documented as the modern counterpart but not wired in (needs
sentence-transformers + UMAP + HDBSCAN, too heavy for this sandbox).

## 11. Text classification

`classification.py`. Optional TF-IDF + Logistic Regression over 9
categories (EARNINGS, M&A, PARTNERSHIP, PRODUCT, REGULATION, MANAGEMENT,
AI_TECHNOLOGY, MACROECONOMICS, OTHER), enabled only when
`CLASSIFICATION_DATASET_PATH` is configured. Without it, keyword rules
are the runtime implementation. When a trained model is configured, a
keyword-rule backstop handles predictions below the confidence
threshold.

## 12. Aspect-based sentiment analysis

`aspect_sentiment.py`. Clause-segmentation (splitting on "but",
"while", "although", etc.) + the classical sentiment model run per
clause, with a keyword lexicon mapping clauses to financial aspects
(earnings, hiring, guidance, ...). Documented as an explainable
clause-level heuristic, not a jointly-trained ABSA transformer.

## 13. Keyword / keyphrase extraction

`tfidf.py::extract_keyphrases`. TF-IDF over n-grams (1–3), IDF computed
against the corpus when available for more meaningful weighting.

## 14. Semantic similarity

`tfidf.py::TfidfIndex` (cosine similarity over TF-IDF vectors) and
`embeddings.py` + `rag.py` (FAISS cosine search over TF-IDF-SVD by
default, or optional transformer embeddings). Word2Vec is implemented
but is not currently selected by the RAG runtime.

## 15. Financial event extraction

`events.py`. Trigger-word pattern matching identifies a candidate event
type; NER supplies ORG/MONEY entities from the same text; simple
positional heuristics assign actor/target/value roles. This is a
template/frame-based information-extraction technique — deliberately
NOT "ask an LLM and call it extraction". The news classifier is
cross-checked as a secondary signal, and disagreements are surfaced
rather than silently resolved.

## 16. Summarization

`summarization.py`. TextRank (Mihalcea & Tarau, 2004): TF-IDF sentence
similarity graph + PageRank centrality selects the most representative
sentences, run entirely locally. Always works without any LLM; an
optional abstractive/LLM-backed layer is a documented future
enhancement, not a requirement for the extractive path to function.

## 17. Clustering

`clustering.py`. Agglomerative clustering (cosine distance,
distance-threshold based so it doesn't need a pre-specified k) over
whichever embedder `embeddings.get_default_embedder` resolves to.

## 18. Transformer models

Documented, optional, and NEVER silently assumed present: FinBERT
(sentiment), spaCy transformer pipelines (NER), sentence-transformers
(embeddings/RAG). See NLP_SETUP.md for exact install steps and why this
sandbox build ships with the classical/gensim/rule-based defaults
instead.

## 19. Integration with market data & attention scoring

See `attention.py` and `src/server/modules/nlp/`. The **existing**
price-based attention engine (`src/server/modules/attention/`) is
untouched; the NLP service computes a separate, explicit `newsScore`
(0–10) per ticker with a documented weighted formula (see the module
docstring and MODEL_EVALUATION.md), and the frontend renders both
side-by-side rather than the NLP layer overriding or replacing the
original logic.

## 20. Limitations (honest accounting)

- Sample datasets are small (dozens of rows); accuracy/F1 numbers are
  real but not representative of production performance — see
  DATASET_SETUP.md to scale up.
- Transformer models (FinBERT, spaCy statistical NER, and
  sentence-transformer embeddings) are optional and are not installed
  in the default environment. Their code paths fall back when packages
  or model weights are unavailable; install them per NLP_SETUP.md to use
  those models.
- ABSA and event extraction are rule/heuristic-based, not jointly
  trained end-to-end models; documented as such rather than
  overclaimed.
- The rule-based NER gazetteer only recognizes companies it's been
  told about (plus generic Title-Case/regex heuristics); it will miss
  novel entities the spaCy path would catch.
- RAG generation quality, when `GROQ_API_KEY` isn't set, is a
  templated extractive answer, not a fluent generated one — this is a
  deliberate anti-hallucination default, not a bug.

## 21. Future improvements

- Install the transformer stack (`requirements-transformers.txt`) and
  re-run `evaluation/evaluate_sentiment.py` for a real classical-vs-
  FinBERT comparison table.
- Swap in the full Financial PhraseBank + a larger scraped financial
  news corpus (DATASET_SETUP.md).
- Add BERTopic as a second topic-modeling path once
  sentence-transformers is available.
- Persist the FAISS index to disk and update it incrementally instead
  of rebuilding per-request.
- Add a jointly-trained ABSA model instead of the current clause
  heuristic.
- Add a real Postgres persistence/cache layer for NLP results (Prisma
  models + migration + a write path in the API routes + a
  read-through/staleness policy), so the dashboard doesn't need a live
  NLP-service round-trip on every page load and historical NLP results
  remain queryable after an article ages out of the NLP service's
  in-memory corpus. Not implemented in this iteration — see the
  "Persistence status" note in section 3.
