import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(monkeypatch):
    data_path = Path(__file__).resolve().parents[1] / "data"
    sample_path = data_path / "sample_news.csv"
    monkeypatch.setenv("NEWS_CORPUS_PATH", str(sample_path))
    monkeypatch.setenv("SENTIMENT_DATASET_PATH", str(data_path / "sample_phrasebank.csv"))
    monkeypatch.setenv("CLASSIFICATION_DATASET_PATH", str(data_path / "sample_news_categories.csv"))
    from app.main import app
    return TestClient(app)


def test_health(client):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_market_quote_endpoint_uses_yfinance(client, monkeypatch):
    from app import market_data

    monkeypatch.setattr(
        market_data,
        "fetch_quote",
        lambda ticker: {
            "symbol": ticker.upper(),
            "price": 2530.0,
            "currency": "INR",
        },
    )
    res = client.get("/market/TCS/quote")
    assert res.status_code == 200
    assert res.json() == {"symbol": "TCS", "price": 2530.0, "currency": "INR"}


def test_market_quote_endpoint_reports_invalid_tickers(client, monkeypatch):
    from app import market_data

    def reject_ticker(ticker):
        raise ValueError("Ticker is invalid.")

    monkeypatch.setattr(market_data, "fetch_quote", reject_ticker)
    res = client.get("/market/BAD/quote")
    assert res.status_code == 400
    assert res.json()["detail"] == "Ticker is invalid."


def test_market_history_endpoint_returns_bars(client, monkeypatch):
    from app import market_data

    monkeypatch.setattr(
        market_data,
        "fetch_history",
        lambda ticker, range_name: [
            {
                "timestamp": "2026-10-23T15:25:00+05:30",
                "open": 2520.0,
                "high": 2535.0,
                "low": 2515.0,
                "close": 2530.0,
                "volume": 86800,
            }
        ],
    )
    res = client.get("/market/TCS/history?range=1d")
    assert res.status_code == 200
    assert res.json()["bars"][0]["close"] == 2530.0


@pytest.mark.parametrize("text", ["a", "A B", "123", "!!!", "a a a a", "A. B. C. D. E."])
def test_text_endpoints_never_500_on_degenerate_input(client, text):
    """Every text-accepting endpoint must degrade gracefully (2xx with an
    empty/fallback result), never raise an unhandled 500, on short or
    degenerate pasted text — this is exactly the kind of input the
    /nlp-demo page's free-text box invites."""
    endpoints = [
        "/nlp/analyze", "/nlp/preprocess", "/nlp/sentiment", "/nlp/entities",
        "/nlp/classify", "/nlp/aspects", "/nlp/events", "/nlp/summarize",
        "/nlp/keyphrases",
    ]
    for ep in endpoints:
        res = client.post(ep, json={"text": text})
        assert res.status_code < 500, f"{ep} raised a server error on {text!r}: {res.text}"


def test_topics_normal_corpus_includes_num_topics(client):
    res = client.get("/nlp/topics")
    assert res.status_code == 200
    body = res.json()
    assert "numTopics" in body
    assert "topics" in body


def test_topics_empty_corpus(monkeypatch, tmp_path):
    """The empty-corpus branch of GET /nlp/topics must still include
    'numTopics', which the Next.js Zod schema (topicsResultSchema)
    requires as non-optional — otherwise a legitimate empty state gets
    reported to the frontend as 'NLP service unavailable' instead of
    'no articles yet'."""
    empty_csv = tmp_path / "empty.csv"
    empty_csv.write_text("id,headline,text,date,source,ticker\n")
    monkeypatch.setenv("NEWS_CORPUS_PATH", str(empty_csv))

    # Re-import app fresh so corpus.load_corpus() picks up the new env var
    # (module-level singletons elsewhere are per-request, not cached at
    # import time, so a plain re-import is sufficient here).
    import importlib
    import app.main as main_module
    importlib.reload(main_module)
    from fastapi.testclient import TestClient as TC
    fresh_client = TC(main_module.app)

    res = fresh_client.get("/nlp/topics")
    assert res.status_code == 200
    body = res.json()
    assert body["numTopics"] == 0
    assert body["topics"] == []
    assert "note" in body


def test_related_news_empty_corpus_returns_clean_404(monkeypatch, tmp_path):
    """The empty-corpus branch of GET /stocks/{ticker}/related-news must
    return a clean 404 rather than a 200 body missing the required
    'articleId' field that the Next.js Zod schema expects."""
    empty_csv = tmp_path / "empty.csv"
    empty_csv.write_text("id,headline,text,date,source,ticker\n")
    monkeypatch.setenv("NEWS_CORPUS_PATH", str(empty_csv))

    import importlib
    import app.main as main_module
    importlib.reload(main_module)
    from fastapi.testclient import TestClient as TC
    fresh_client = TC(main_module.app)

    res = fresh_client.get("/stocks/TCS/related-news")
    assert res.status_code == 404


def test_nlp_intelligence_unknown_ticker_matches_schema(client):
    """An unrecognized ticker must still return a well-formed body (zero
    counts, null summary) rather than an error, per the 'graceful
    empty/sample state' requirement."""
    res = client.get("/stocks/NOSUCHTICKER/nlp-intelligence")
    assert res.status_code == 200
    body = res.json()
    assert body["sentiment"]["articleCount"] == 0
    assert body["attention"]["newsAttentionScore"] == 0.0


def test_rag_query_endpoint(client):
    res = client.post("/rag/query", json={"query": "Why is TCS moving today?", "ticker": "TCS"})
    assert res.status_code == 200
    body = res.json()
    assert "answer" in body
    assert "sources" in body


def test_corpus_info_endpoint(client, monkeypatch):
    monkeypatch.delenv("NEWS_CORPUS_PATH", raising=False)
    res = client.get("/corpus/info")
    assert res.status_code == 200
    assert res.json() == {"kind": "live", "articleCount": 0}


def test_rag_query_accepts_generate_false(client):
    res = client.post("/rag/query", json={"query": "Why is TCS moving?", "ticker": "TCS", "generate": False})
    assert res.status_code == 200
    assert "skipped by caller" in res.json()["generation"]
