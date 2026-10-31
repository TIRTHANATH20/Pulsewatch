# nlp-service/data/

Sample datasets retained for tests and evaluation. They are not loaded by
live requests unless explicitly configured. See
`../../DATASETS.md` for full provenance (source, purpose, fields, label
definitions) of each file, and `../../DATASET_SETUP.md` for how to
replace these with real datasets.

- `sample_phrasebank.csv` — 75 hand-written sentiment-labeled sentences
  (Financial PhraseBank-style: `text,label` with `positive`/`neutral`/
  `negative`). Used by tests/evaluation; configure
  `SENTIMENT_DATASET_PATH` to opt into training the classical model.
- `sample_news_categories.csv` — 40 hand-labeled news snippets across 9
  categories. Used by tests/evaluation; configure
  `CLASSIFICATION_DATASET_PATH` to opt into training the classifier.
- `sample_news.csv` — 15 short financial news articles across 4 tickers
  (TCS, RELIANCE, INFY, HDFC), used by tests/evaluation and only
  available to the runtime corpus when `NEWS_CORPUS_PATH` explicitly
  points to it. Otherwise ticker news comes from Yahoo Finance.

None of these are large — safe to keep in version control. Do not add
scraped/licensed datasets here directly; point `NEWS_CORPUS_PATH` at an
external location instead (see DATASET_SETUP.md).
