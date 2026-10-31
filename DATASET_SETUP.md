# DATASET_SETUP.md

PulseWatch's NLP service includes small sample datasets for tests and
evaluation, but they are not loaded by live requests by default. See
DATASETS.md for their provenance. This document describes configuring
licensed real datasets for the optional trained classifiers.

## 1. Financial PhraseBank (sentiment)

Used by the optional classical sentiment model in
`app/pipeline/sentiment.py`.

1. Download from the official source (search "Financial PhraseBank
   Malo et al. 2014" — commonly distributed via Hugging Face Datasets
   `financial_phrasebank` or the original researchers' page). Respect
   its license/citation requirements.
2. Convert to CSV with exactly two columns: `text,label` where `label`
   is one of `positive`, `neutral`, `negative` (lowercase).
3. Save as `nlp-service/data/financial_phrasebank_full.csv`.
4. Point the service at it with:

   ```bash
   export SENTIMENT_DATASET_PATH=/absolute/path/to/financial_phrasebank_full.csv
   ```

## 2. Financial news corpus (NER, topics, embeddings, clustering, events, RAG)

Used by `app/pipeline/corpus.py`. Any CSV/JSON/JSONL matching this
schema:

```json
{
  "id": "n001",
  "headline": "TCS signs $2 billion AI partnership with Microsoft",
  "text": "Full article body...",
  "date": "2026-08-12",
  "source": "MarketWire",
  "ticker": "TCS"
}
```

Options:
- Kaggle financial news datasets (search "financial news headlines
  dataset" / "Reuters financial news").
- A scraper you control, respecting each source's terms of service —
  **do not** scrape paywalled content.
- Your own curated set (the shipped `sample_news.csv` is exactly this,
  just small).

Place the file at `nlp-service/data/` and point `NEWS_CORPUS_PATH` at
it:

```bash
export NEWS_CORPUS_PATH=/absolute/path/to/your_news.csv
```

If unset, per-ticker news is fetched live from Yahoo Finance through
`yfinance`. Corpus-wide endpoints return an empty result with a note
because there is no ticker to query. A missing configured file also
returns an empty corpus rather than crashing — verified by
`tests/test_pipeline.py::test_attention_score_handles_unknown_ticker_gracefully`.

## 3. News category labels (optional, for classification.py)

Prepare a `text,label` CSV where `label` is one of the categories in
`classification.CATEGORIES`, then configure it with
`CLASSIFICATION_DATASET_PATH`. If unset, the API uses keyword rules
instead of training on the bundled sample.

## 4. Do not commit large datasets

`.gitignore` already excludes common large-data patterns; add your
dataset paths there explicitly if they don't match. Keep only the small
sample files in version control.

## 5. If no dataset is present

Every pipeline module that depends on the corpus (`corpus.load_corpus()`
returning `[]`) has an explicit empty-state branch — checked by the test
suite — so the API starts and responds with `{"note": "No corpus
loaded..."}`-style payloads instead of 500ing. Without configured labeled
datasets, sentiment uses FinBERT when available (otherwise a transparent
lexicon baseline) and category classification uses keyword rules. The
bundled sample labels are used only by tests/evaluation unless explicitly
configured.
