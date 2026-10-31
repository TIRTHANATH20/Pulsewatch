# NLP_SETUP.md

## 0. Environment versions used for this build

Verified in the current local environment:
- **Python**: 3.11.13 (the service requires Python 3.11+)
- **Node.js**: 25.8.2 (the launcher requires Node.js 20+)
- **Next.js**: 14.2.35, **React**: 18.3.x, **TypeScript**: 5.6.x (see `package.json`)
- **Python packages**: FastAPI 0.162.0, scikit-learn 1.9.1, gensim 4.4.0,
  faiss-cpu 1.15.1, pandas 3.1.0, numpy 2.4.6
- **PostgreSQL**: whatever version the base PulseWatch app already
  targets (unchanged by this work — see the root `README.md`)

Reproducibility notes:
- All model-training code paths use a fixed `random_state=42` (or an
  explicit `seed` parameter defaulting to 42) — see `sentiment.py`,
  `classification.py`, `topics.py`, `embeddings.py`. Re-running any
  evaluation script or the test suite reproduces the same numbers.
- The evaluation scripts (`evaluation/evaluate_sentiment.py`,
  `evaluation/evaluate_classification.py`) regenerate their numeric
  reports from scratch; `MODEL_EVALUATION.md` documents their
  methodology and limitations.

## 1. Run the Next.js app (unchanged)

```bash
npm install
npx prisma generate
npx prisma migrate dev
npm run dev
```

PulseWatch's core watchlist/attention functionality works with **zero**
Python dependency. If `NLP_FEATURE_ENABLED=false` or the NLP service
isn't running, NLP panels show a quiet "unavailable" state instead of
breaking anything (see `src/server/modules/nlp/client.ts`).

## 2. Run the NLP service

```bash
cd nlp-service
python3 -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Verify it's up: `curl http://localhost:8000/health` → `{"status":"ok",...}`.

Set in your Next.js `.env`:

```
NLP_SERVICE_URL=http://localhost:8000
NLP_SERVICE_TIMEOUT_MS=8000
NLP_FEATURE_ENABLED=true
```

The default market provider uses the Python `yfinance` library and fetches
quotes and chart history from Yahoo Finance. It is already included in
`requirements.txt`; data may be delayed or rate-limited and is not an
official real-time feed. Ticker news is also fetched from Yahoo Finance
through yfinance; it can be unavailable for some symbols.
Common NSE symbols such as `TCS` are mapped to `TCS.NS`; other tickers can
include their Yahoo suffix, for example `RELIANCE.BO`.
Yahoo's search-news response may provide only headlines rather than article
body text; NLP and RAG use only the title/summary Yahoo returns and do not
scrape full publisher pages.

## 3. Optional: transformer models (FinBERT, spaCy, sentence-transformers)

Not installed by default because transformer libraries and model weights
add substantial download and disk requirements. On a machine where you
want those optional models:

```bash
cd nlp-service
pip install -r requirements.txt -r requirements-transformers.txt
python -m spacy download en_core_web_sm
```

First run will download:
- FinBERT (`ProsusAI/finbert`, ~440MB) — used automatically by
  `sentiment.predict_sentiment()` once available. If it cannot load, the
  service uses a configured classical model or an explicitly labeled
  rule-based lexicon fallback.
- `sentence-transformers/all-MiniLM-L6-v2` (~90MB) — used automatically
  by `embeddings.get_default_embedder()` for RAG/clustering/similarity.
- `en_core_web_sm` (~12MB) — used automatically by `ner.get_ner_engine()`.

No code changes needed — every one of these has a try/except-guarded
optional path in the pipeline modules and reports which implementation
actually served each request (`modelUsed` / `engine` / `embeddingMethod`
fields in API responses).

The bundled sentiment/category labels are sample data and are not used to
train live classifiers by default. To opt into classical models, set
`SENTIMENT_DATASET_PATH` and/or `CLASSIFICATION_DATASET_PATH` in the
Python service environment to external, appropriately licensed CSV files.
Without those paths, sentiment uses FinBERT if available (otherwise a
rule-based lexicon) and categories use keyword rules.

## 4. Optional: Groq-backed LLM answers

PulseWatch AI's chat uses Groq. Put your key in the root `.env` file:

```
GROQ_API_KEY=your_groq_api_key
```

Select a Groq-supported model with `CHAT_LLM_MODEL` if desired. Without
the key, chat uses its labelled evidence-only fallback. The legacy
Python `/rag/query` generation option also supports Groq; for that
endpoint, set `GROQ_API_KEY` in the Python service's environment. Chat
uses retrieval-only from Python and calls Groq from the Next.js server.

## 5. Run both together

After configuring `.env` and applying the Prisma migration, the repository
root launcher can start both services in one terminal:

```bash
./start.sh
```

It creates the Python virtual environment and installs the service
requirements on first use. Use `./start.sh --no-nlp` to start only Next.js.
Alternatively, run the services manually in two terminals:

```bash
# Terminal 1
cd nlp-service && uvicorn app.main:app --reload --port 8000

# Terminal 2
npm run dev
```

Visit `http://localhost:3000`, then open PulseWatch AI and ask about a symbol
such as TCS to retrieve market data, news and NLP-backed evidence. Use
`/nlp-demo` to paste arbitrary text through the full pipeline.

## 6. Run the tests

```bash
# Python NLP service
cd nlp-service
pip install -r requirements-dev.txt   # requirements.txt + pytest + httpx (TestClient dep)
python -m pytest tests/ -v

# Next.js
npm test          # vitest run
npm run typecheck # tsc --noEmit
npm run lint       # eslint
```

## 7. Run the evaluation scripts

```bash
cd nlp-service
python evaluation/evaluate_sentiment.py        # sentiment: classical vs optional FinBERT
python evaluation/evaluate_classification.py   # news category classifier
```

Writes real, measured metrics (train/test sizes, accuracy, precision,
recall, F1, confusion matrix) to `evaluation/metrics_report.md` and
`evaluation/classification_metrics_report.md` respectively. See
MODEL_EVALUATION.md for the current output of both, with methodology
notes (train/test split, no separate dev split and why, dataset-size
caveats).

## 8. Docker (optional)

```bash
cd nlp-service
docker build -t pulsewatch-nlp .
docker run -p 8000:8000 pulsewatch-nlp
```
