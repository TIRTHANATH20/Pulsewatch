# PulseWatch NLP Service

Standalone FastAPI microservice implementing PulseWatch's NLP pipeline.
See `../NLP_ARCHITECTURE.md` for design, `../NLP_SETUP.md` to run it,
`../DATASET_SETUP.md` for datasets, and `../MODEL_EVALUATION.md` /
`../RAG_ARCHITECTURE.md` for evaluation and the RAG layer.

Quick start:

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Market data endpoints (used when the Next.js app has
`MARKET_DATA_PROVIDER=yfinance`):

```text
GET /market/{ticker}/quote
GET /market/{ticker}/history?range=1D|1W|1M|3M|1Y
```

These endpoints use the Python `yfinance` library to retrieve Yahoo Finance
quotes and history. Yahoo Finance data may be delayed or rate-limited; the
library does not make it an official or guaranteed real-time feed.

Individually callable agent cards and run endpoints are also available. The
Next.js chat uses the LangGraph workflow endpoint, while the legacy NLP routes
remain available:

```text
GET  /agents
GET  /agents/{agent-id}
POST /agents/{agent-id}/run
POST /chat/graph
```

`POST /chat/graph` accepts `message`, optional `history`, and optional
`known_symbols`, and returns the same `ChatResponse` shape consumed by the
Next.js chat UI. The workflow runs the market, news, NLP, evidence, explanation,
and verification agents as LangGraph nodes.

Available agent IDs are `market-context`, `news-research`, `nlp-analysis`,
`evidence-rag`, `explanation`, and `verification`. Each `GET` card reports the
agent's name, capabilities, input contract, and output contract. Each `POST`
run endpoint returns an `agent`, `status`, and structured `result`, following
the same shape as the standalone Python agent example.

```bash
python -m pytest tests/ -v
```
