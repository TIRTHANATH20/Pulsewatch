# DATASETS.md

This document lists the sample datasets physically included in this
repository, their purpose and limitations. They are **not** used as the
default live news feed: ticker news is fetched from Yahoo Finance unless
`NEWS_CORPUS_PATH` explicitly selects a custom corpus.

**All three datasets below are hand-written sample/demo data created for
this project, not scraped or downloaded from an external source, and not
claimed to be the Financial PhraseBank or any other named public
dataset.** They are not used by default in live runtime requests. To train
the classical sentiment or category classifiers, explicitly configure
`SENTIMENT_DATASET_PATH` or `CLASSIFICATION_DATASET_PATH` with a suitable
labeled dataset. Without those paths, sentiment uses FinBERT when
available and otherwise a disclosed lexicon baseline; categories use
keyword rules. The sample news file is for evaluation/tests and only
becomes a runtime corpus when explicitly configured.

---

## 1. `nlp-service/data/sample_phrasebank.csv`

- **Status**: Sample/demo data. **Not** the real Financial PhraseBank
  (Malo et al., 2014) — styled after it (short financial sentences
  labeled positive/neutral/negative) but hand-written for this project.
- **Source**: Hand-written for this repository.
- **Purpose**: Evaluation fixture for the optional classical sentiment model
  (`app/pipeline/sentiment.py::ClassicalSentimentModel`).
- **Size**: 75 rows.
- **Fields**:
  | Field | Type | Description |
  |---|---|---|
  | `text` | string | A short financial sentence |
  | `label` | string | One of `positive`, `neutral`, `negative` (lowercase) |
- **Label definitions**: `positive` — the sentence describes a
  favorable financial outcome or expectation (e.g. revenue growth,
  earnings beat). `negative` — an unfavorable outcome (e.g. losses,
  layoffs, regulatory fines). `neutral` — factual/administrative
  statements with no clear favorable/unfavorable framing (e.g. meeting
  schedules, routine filings).
- **Class balance**: roughly even across the three labels (~25 rows
  each) by construction.
- **Known limitation**: too small for a statistically reliable accuracy
  estimate — see MODEL_EVALUATION.md. Swap in the real Financial
  PhraseBank per DATASET_SETUP.md for meaningful numbers.
- **License/attribution**: original text written for this project; no
  third-party license applies. If you replace this file with the real
  Financial PhraseBank, note that dataset's own citation/license
  requirements (see DATASET_SETUP.md).

## 2. `nlp-service/data/sample_news_categories.csv`

- **Status**: Sample/demo data, hand-written for this project.
- **Source**: Hand-written for this repository.
- **Purpose**: Evaluation fixture for the optional trained news category classifier
  (`app/pipeline/classification.py::NewsClassifier`).
- **Size**: 40 rows.
- **Fields**:
  | Field | Type | Description |
  |---|---|---|
  | `text` | string | A short financial news sentence/snippet |
  | `label` | string | One of the 9 categories below |
- **Label definitions** (`classification.CATEGORIES`):
  `EARNINGS` (quarterly results, profit/revenue), `M&A` (mergers,
  acquisitions, takeovers), `PARTNERSHIP` (collaborations, alliances,
  tie-ups), `PRODUCT` (launches, new offerings), `REGULATION`
  (fines, lawsuits, regulatory scrutiny), `MANAGEMENT` (leadership
  changes, executive appointments/resignations), `AI_TECHNOLOGY`
  (AI/ML/cloud infrastructure investment), `MACROECONOMICS`
  (interest rates, inflation, GDP, central-bank policy), `OTHER`
  (administrative/no clear category).
- **Class balance**: roughly 4-5 rows per category (imbalanced test-fold
  behavior documented in MODEL_EVALUATION.md).
- **Known limitation**: too small for reliable per-class metrics — several
  classes will show 0 precision/recall on any given split purely from
  sample size. See MODEL_EVALUATION.md.
- **License/attribution**: original text written for this project.

## 3. `nlp-service/data/sample_news.csv`

- **Status**: Sample/demo data, hand-written for this project. **Not**
  real news wire content and not scraped from any publisher — headlines,
  sources (`MarketWire`, `FinNews`, `RegWatch`), and dates are fictional.
- **Source**: Hand-written for this repository. Ticker/company names
  (TCS, Reliance, Infosys, HDFC Bank) are real companies, but the
  specific articles describing them are fictional illustrative examples,
  not real reporting.
- **Purpose**: Test/evaluation fixture and optional explicitly configured
  corpus. It is not loaded by default in the running application.
- **Size**: 15 articles across 4 tickers.
- **Fields**:
  | Field | Type | Description |
  |---|---|---|
  | `id` | string | Unique article id (e.g. `n001`) |
  | `headline` | string | Article headline |
  | `text` | string | Article body (1-3 sentences) |
  | `date` | string | ISO date (`YYYY-MM-DD`), fictional |
  | `source` | string | Fictional publication name |
  | `ticker` | string | Stock ticker the article is about |
- **Known limitation**: far too small and too clean to represent a real
  news feed. Do not set `NEWS_CORPUS_PATH` to this file for real-data use.
  Without that setting, ticker news and ticker-specific RAG retrieval
  request current articles through yfinance.
- **License/attribution**: original fictional text written for this
  project; no third-party license applies.

---

## What is NOT included in this repository

- The real Financial PhraseBank dataset (must be downloaded separately;
  see DATASET_SETUP.md §1).
- Any full, licensed real financial sentiment/category training corpus
  (see DATASET_SETUP.md).
- Any pretrained model weights (FinBERT, spaCy models, sentence-transformer
  models) — these are downloaded on demand by the optional transformer
  path, never bundled in this repo (see NLP_SETUP.md §3).

## Data collection & ethics note

The default ticker news and market prices are fetched through yfinance
from Yahoo Finance; yfinance is an unofficial client, and Yahoo may
delay, throttle, or change its service. The bundled sample datasets were
authored directly for this project. If you configure a different real
news source or corpus, comply with its terms of service and applicable
copyright/licensing terms.
