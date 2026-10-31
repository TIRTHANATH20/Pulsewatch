from __future__ import annotations

import json
import logging
import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from . import market_data

from .schemas import TextIn, RagQueryIn
from .pipeline import preprocessing, tfidf, sentiment, ner, topics, embeddings
from .pipeline import classification, aspect_sentiment, events, summarization
from .pipeline import clustering, rag, attention, corpus
from .agents import (
    evidence_rag_agent,
    explanation_agent,
    market_context_agent,
    news_research_agent,
    nlp_analysis_agent,
    verification_agent,
)
from .agents.graph import run_graph
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class ChatGraphIn(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    history: list[dict] = Field(default_factory=list, max_length=20)
    known_symbols: list[str] = Field(default_factory=list, max_length=200)


class MarketSearchResult(BaseModel):
    symbol: str
    name: str
    exchange: str | None = None


class MarketInsight(BaseModel):
    symbol: str
    direction: str
    confidence: str
    recommendation: str
    summary: str
    basis: str
    source: str
    rag_context: list[str]

app = FastAPI(
    title="PulseWatch NLP Service",
    description="Standalone NLP microservice for PulseWatch financial market intelligence.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten to the Next.js origin in production; see NLP_SETUP.md
    allow_methods=["*"],
    allow_headers=["*"],
)

for agent_router in (
    market_context_agent.router,
    news_research_agent.router,
    nlp_analysis_agent.router,
    evidence_rag_agent.router,
    explanation_agent.router,
    verification_agent.router,
):
    app.include_router(agent_router)


@app.get("/agents")
def agent_directory():
    """Lists the independently callable agent cards without changing legacy APIs."""
    cards = (
        market_context_agent.CARD,
        news_research_agent.CARD,
        nlp_analysis_agent.CARD,
        evidence_rag_agent.CARD,
        explanation_agent.CARD,
        verification_agent.CARD,
    )
    return {"agents": [card.model_dump() for card in cards]}


@app.get("/health")
def health():
    return {"status": "ok", "service": "pulsewatch-nlp"}


@app.post("/chat/graph")
def chat_graph(payload: ChatGraphIn):
    """Runs the production chat workflow through the LangGraph agent graph."""
    return run_graph(payload.message, payload.history, payload.known_symbols)


def _ticker_articles(ticker: str):
    try:
        return corpus.articles_for_ticker(ticker)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
    except Exception as err:
        raise HTTPException(
            status_code=502,
            detail=f"Yahoo Finance news request failed: {type(err).__name__}",
        ) from err


@app.get("/market/{ticker}/quote")
def market_quote(ticker: str):
    try:
        return market_data.fetch_quote(ticker)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
    except LookupError as err:
        raise HTTPException(status_code=404, detail=str(err)) from err
    except Exception as err:
        raise HTTPException(
            status_code=502,
            detail=f"Yahoo Finance quote request failed: {err}",
        ) from err


@app.get("/market/{ticker}/history")
def market_history(ticker: str, range: str = "1M"):
    try:
        return {"bars": market_data.fetch_history(ticker, range.upper())}
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
    except Exception as err:
        raise HTTPException(
            status_code=502,
            detail=f"Yahoo Finance history request failed: {err}",
        ) from err


@app.get("/market/search", response_model=list[MarketSearchResult])
def market_search(q: str):
    query = q.strip()
    if len(query) < 2 or len(query) > 80:
        raise HTTPException(status_code=400, detail="Search must be 2 to 80 characters.")
    try:
        import yfinance as yf
        quotes = yf.Search(query, max_results=8).quotes
        results = []
        for quote in quotes:
            if quote.get("quoteType") != "EQUITY":
                continue
            symbol = str(quote.get("symbol", "")).upper()
            name = str(quote.get("longname") or quote.get("shortname") or "").strip()
            if symbol and name and symbol not in {item.symbol for item in results}:
                results.append(MarketSearchResult(
                    symbol=symbol,
                    name=name,
                    exchange=str(quote.get("exchDisp") or quote.get("exchange") or "") or None,
                ))
        return results
    except Exception as err:
        raise HTTPException(
            status_code=502,
            detail=f"Company search failed: {type(err).__name__}",
        ) from err


@app.get("/market/{ticker}/insight", response_model=MarketInsight)
def market_insight(ticker: str, purpose: str = "holding"):
    try:
        quote = market_data.fetch_quote(ticker)
        bars = market_data.fetch_history(ticker, "1M")
        closes = [float(bar["close"]) for bar in bars if float(bar["close"]) > 0]
        news = market_data.fetch_news(ticker, count=6)
        latest_change = (
            (quote["price"] - quote["previousClose"]) / quote["previousClose"] * 100
            if isinstance(quote.get("previousClose"), (int, float)) and quote["previousClose"]
            else 0.0
        )
        if len(closes) >= 2:
            change = (closes[-1] - closes[0]) / closes[0] * 100
        else:
            change = 0.0
        if change > 1:
            direction, confidence = "up", "moderate"
        elif change < -1:
            direction, confidence = "down", "moderate"
        else:
            direction, confidence = "flat", "low"
        recommendation = (
            "consider" if direction == "up"
            else "wait" if direction == "flat"
            else "avoid"
        ) if purpose == "buy" else "hold"
        grounded_summary = (
            f"{quote['symbol']} has a {direction} one-month trend ({change:+.2f}%)."
        )
        llm_summary = grounded_summary
        insight_source = "deterministic_fallback"
        daily_returns = [
            (closes[index] - closes[index - 1]) / closes[index - 1] * 100
            for index in range(1, len(closes))
            if closes[index - 1]
        ]
        average_return = sum(daily_returns) / len(daily_returns) if daily_returns else 0
        volatility = (
            sum((item - average_return) ** 2 for item in daily_returns) / len(daily_returns)
        ) ** 0.5 if daily_returns else 0
        recent_window = closes[-6:] if len(closes) >= 6 else closes
        recent_change = (
            (recent_window[-1] - recent_window[0]) / recent_window[0] * 100
            if len(recent_window) >= 2 and recent_window[0]
            else change
        )
        monthly_high = max(closes) if closes else quote["price"]
        drawdown = (closes[-1] - monthly_high) / monthly_high * 100 if monthly_high else 0
        down_streak = 0
        for index in range(len(closes) - 1, 0, -1):
            if closes[index] < closes[index - 1]:
                down_streak += 1
            else:
                break
        # A single red session is a normal pullback, not enough evidence to sell.
        # Require confirmation from multiple time horizons before forcing a sell.
        sell_signal = (
            (recent_change <= -4 and down_streak >= 2)
            or (drawdown <= -8 and recent_change <= -2)
            or (change <= -8 and recent_change <= -3 and down_streak >= 3)
        )
        weakening = sell_signal
        rag_context = [
            f"{len(closes)} daily prices checked",
            f"1-month change: {change:+.2f}%",
            f"Last 5 sessions: {recent_change:+.2f}%",
            f"Drop from recent high: {abs(drawdown):.2f}%",
            f"Down days in a row: {down_streak}",
            f"Recent news items: {len(news)}",
        ]
        if weakening:
            if purpose == "buy":
                recommendation = "avoid"
            else:
                recommendation = "sell"
            confidence = "moderate"
        evidence = {
            "symbol": quote["symbol"],
            "purpose": purpose,
            "latest_price": quote["price"],
            "one_month_change_percent": round(change, 2),
            "recent_five_session_change_percent": round(recent_change, 2),
            "latest_session_change_percent": round(latest_change, 2),
            "drawdown_from_monthly_high_percent": round(drawdown, 2),
            "consecutive_down_sessions": down_streak,
            "recent_momentum": "weakening" if weakening else "stable_or_improving",
            "daily_volatility_percent": round(volatility, 2),
            "observations": len(closes),
            "recent_closes": [round(value, 2) for value in closes[-10:]],
            "news": [
                {"headline": item.get("headline", ""), "summary": item.get("summary", "")}
                for item in news[:6]
            ],
        }
        api_key = os.environ.get("GROQ_API_KEY")
        if api_key:
            try:
                import requests
                response = requests.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                    json={
                        "model": os.environ.get("CHAT_LLM_MODEL", "llama-3.3-70b-versatile"),
                        "temperature": 0.2,
                        "max_tokens": 700,
                        "messages": [
                            {
                                "role": "system",
                                "content": "You are a financial research analyst. Use only the market data and news given. Use very simple English, like you are explaining it to a new investor. Avoid words such as bearish, bullish, drawdown, volatility, momentum, sustained, outlook, and advisable; use plain words such as falling, rising, recent move, price swings, and likely next move. Keep the summary to 1 or 2 short sentences. A single down session or a small daily loss is a normal pullback and is not enough to recommend selling. For an existing holding, recommendation must be exactly hold or sell; recommend sell only when the evidence shows weakness across several sessions or a large fall from the recent high. For a prospective purchase, recommendation must be consider, wait, or avoid. Return valid JSON only with keys: direction (up, down, or flat), confidence (low or moderate), recommendation, and summary. Do not invent facts or numbers.",
                            },
                            {
                                "role": "user",
                                "content": f"Retrieved evidence for a {purpose} decision:\n{evidence}",
                            },
                        ],
                    },
                    timeout=25,
                )
                if not response.ok:
                    logger.warning("Groq market insight response: %s", response.text[:500])
                response.raise_for_status()
                content = response.json().get("choices", [{}])[0].get("message", {}).get("content")
                if isinstance(content, str) and content.strip():
                    parsed = json.loads(content.strip().removeprefix("```json").removesuffix("```").strip())
                    parsed_confidence = parsed.get("confidence")
                    if isinstance(parsed_confidence, (int, float)):
                        parsed_confidence = "moderate" if parsed_confidence >= 0.6 else "low"
                    elif isinstance(parsed_confidence, str) and parsed_confidence.lower() in {"medium", "high"}:
                        parsed_confidence = "moderate"
                    parsed_recommendation = parsed.get("recommendation")
                    if purpose == "buy" and parsed_recommendation == "hold":
                        parsed_recommendation = "wait"
                    if purpose != "buy" and parsed_recommendation == "review":
                        parsed_recommendation = "sell"
                    if (
                        parsed.get("direction") in {"up", "down", "flat"}
                        and parsed_confidence in {"low", "moderate"}
                        and parsed_recommendation in {"consider", "wait", "avoid", "hold", "sell"}
                        and (purpose == "buy" or parsed_recommendation != "sell" or sell_signal)
                        and isinstance(parsed.get("summary"), str)
                    ):
                        direction = parsed["direction"]
                        confidence = parsed_confidence
                        recommendation = (
                            parsed_recommendation
                            if purpose == "buy" or parsed_recommendation != "sell" or sell_signal
                            else "hold"
                        )
                        llm_summary = parsed["summary"].strip()
                        insight_source = "llm_rag"
                    elif (
                        isinstance(parsed.get("summary"), str)
                        and parsed["summary"].strip()
                        and not (purpose != "buy" and parsed_recommendation == "sell" and not sell_signal)
                    ):
                        llm_summary = parsed["summary"].strip()
                        insight_source = "llm_rag"
                if weakening:
                    if recent_change < 0:
                        direction = "down"
                    recommendation = "avoid" if purpose == "buy" else "sell"
            except (requests.RequestException, ValueError, KeyError, IndexError, TypeError, json.JSONDecodeError):
                logger.warning("Groq market insight generation failed for %s", ticker, exc_info=True)
                llm_summary = grounded_summary
        return MarketInsight(
            symbol=quote["symbol"],
            direction=direction,
            confidence=confidence,
            recommendation=recommendation,
            summary=llm_summary,
            basis=f"RAG context: {len(closes)} Yahoo Finance daily closes, volatility, and {len(news)} recent news articles.",
            source=insight_source,
            rag_context=rag_context,
        )
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
    except Exception as err:
        raise HTTPException(
            status_code=502,
            detail=f"Market insight unavailable: {type(err).__name__}",
        ) from err


# ---------------------------------------------------------------- demo --
@app.post("/nlp/analyze")
def analyze(payload: TextIn):
    """Runs the full pipeline on one piece of text. Powers the NLP Demo page."""
    text = payload.text
    pre = preprocessing.preprocess(text)
    sent = sentiment.predict_sentiment(text)
    entities = ner.extract_entities(text)
    category = classification.classify_text(text)
    aspects = aspect_sentiment.analyze_aspects(text)
    event_result = events.extract_events(text)
    keyphrases = tfidf.extract_keyphrases(text, corpus_texts=[a.full_text for a in corpus.load_corpus()])

    background = [a.full_text for a in corpus.load_corpus()]
    similar = []
    if background:
        idx = tfidf.build_tfidf_index([a.id for a in corpus.load_corpus()], background)
        similar = idx.similar_to_text(text, top_k=3)

    embedder, method = embeddings.get_default_embedder(background or [text])

    return {
        "preprocessing": pre.to_dict(),
        "sentiment": sent.__dict__,
        "entities": entities,
        "category": category,
        "aspectSentiment": aspects,
        "event": event_result,
        "keyphrases": keyphrases,
        "similarArticles": similar,
        "embeddingInfo": {"method": method, "dimension": len(embedder.embed(text))},
    }


# ------------------------------------------------------------ per-part --
@app.post("/nlp/preprocess")
def api_preprocess(payload: TextIn):
    return preprocessing.preprocess(payload.text).to_dict()


@app.post("/nlp/sentiment")
def api_sentiment(payload: TextIn):
    return sentiment.predict_sentiment(payload.text).__dict__


@app.get("/nlp/sentiment/evaluate")
def api_sentiment_evaluate():
    model = sentiment.get_classical_model()
    return model.evaluate() if model is not None else {
        "available": False,
        "note": "Set SENTIMENT_DATASET_PATH to evaluate a configured labeled dataset.",
    }


@app.post("/nlp/entities")
def api_entities(payload: TextIn):
    return ner.extract_entities(payload.text)


@app.post("/nlp/classify")
def api_classify(payload: TextIn):
    return classification.classify_text(payload.text)


@app.get("/nlp/classify/evaluate")
def api_classify_evaluate():
    model = classification.get_classifier()
    return model.evaluate() if model is not None else {
        "available": False,
        "note": "Set CLASSIFICATION_DATASET_PATH to evaluate a configured labeled dataset.",
    }


@app.post("/nlp/aspects")
def api_aspects(payload: TextIn):
    return aspect_sentiment.analyze_aspects(payload.text)


@app.post("/nlp/events")
def api_events(payload: TextIn):
    return events.extract_events(payload.text)


@app.post("/nlp/summarize")
def api_summarize(payload: TextIn):
    return summarization.summarize_text(payload.text)


@app.post("/nlp/keyphrases")
def api_keyphrases(payload: TextIn):
    background = [a.full_text for a in corpus.load_corpus()]
    return {"keyphrases": tfidf.extract_keyphrases(payload.text, corpus_texts=background)}


@app.get("/nlp/topics")
def api_topics(num_topics: int = 5):
    articles = corpus.load_corpus()
    if not articles:
        return {"numTopics": 0, "topics": [], "note": "No corpus loaded. See DATASET_SETUP.md."}
    result = topics.run_lda([a.full_text for a in articles], num_topics=num_topics)
    return {
        "numTopics": result.num_topics,
        "topics": result.topics,
        "docTopics": dict(zip([a.id for a in articles], result.doc_topics)),
    }


@app.get("/nlp/clusters")
def api_clusters():
    articles = corpus.load_corpus()
    if not articles:
        return {"clusters": [], "note": "No corpus loaded. See DATASET_SETUP.md."}
    return clustering.cluster_articles([a.id for a in articles], [a.full_text for a in articles])


@app.get("/corpus/info")
def api_corpus_info():
    """Reports whether ticker news comes from Yahoo Finance or a supplied corpus."""
    return corpus.corpus_info()


# ------------------------------------------------------------- per-ticker
@app.get("/stocks/{ticker}/news")
def stock_news(ticker: str):
    articles = _ticker_articles(ticker)
    return {"ticker": ticker.upper(), "count": len(articles), "articles": [a.__dict__ for a in articles]}


@app.get("/stocks/{ticker}/sentiment")
def stock_sentiment(ticker: str):
    articles = _ticker_articles(ticker)
    if not articles:
        return {"ticker": ticker.upper(), "articleCount": 0, "overallSentiment": None}
    results = [sentiment.predict_sentiment(a.text) for a in articles]
    positive = sum(1 for r in results if r.sentiment == "POSITIVE")
    negative = sum(1 for r in results if r.sentiment == "NEGATIVE")
    neutral = len(results) - positive - negative
    overall = "POSITIVE" if positive > negative and positive > neutral else (
        "NEGATIVE" if negative > positive and negative > neutral else "NEUTRAL"
    )
    return {
        "ticker": ticker.upper(),
        "articleCount": len(articles),
        "distribution": {"positive": positive, "neutral": neutral, "negative": negative},
        "overallSentiment": overall,
        "avgConfidence": round(sum(r.confidence for r in results) / len(results), 4),
        "perArticle": [
            {"articleId": a.id, "headline": a.headline, **r.__dict__}
            for a, r in zip(articles, results)
        ],
    }


@app.get("/stocks/{ticker}/topics")
def stock_topics(ticker: str):
    articles = _ticker_articles(ticker)
    if len(articles) < 2:
        return {"ticker": ticker.upper(), "topics": [], "note": "Not enough live articles to infer topics."}
    result = topics.run_lda([a.full_text for a in articles], num_topics=min(5, len(articles)))
    return {
        "ticker": ticker.upper(),
        "topics": topics.aggregate_document_topics(result.doc_topics),
    }


@app.get("/stocks/{ticker}/events")
def stock_events(ticker: str):
    articles = _ticker_articles(ticker)
    out = []
    for a in articles:
        result = events.extract_events(a.full_text)
        if result["eventDetected"]:
            out.append({"articleId": a.id, "headline": a.headline, **result["events"][0]})
    return {"ticker": ticker.upper(), "events": out}


@app.get("/stocks/{ticker}/summary")
def stock_summary(ticker: str):
    articles = _ticker_articles(ticker)
    if not articles:
        return {"ticker": ticker.upper(), "summary": None}
    headlines = list(dict.fromkeys(a.headline.strip() for a in articles if a.headline.strip()))
    has_article_text = any(
        a.text.strip() and a.text.strip() != a.headline.strip()
        for a in articles
    )
    if not has_article_text:
        return {
            "ticker": ticker.upper(),
            "summary": (
                "Yahoo Finance returned headlines without article summaries. Recent headlines: "
                + " · ".join(headlines[:3])
            ),
            "method": "Yahoo Finance headline-only news",
        }
    return {
        "ticker": ticker.upper(),
        **summarization.summarize_articles(
            [
                a.text
                for a in articles
                if a.text.strip() and a.text.strip() != a.headline.strip()
            ],
        ),
    }


@app.get("/stocks/{ticker}/related-news")
def stock_related_news(ticker: str, article_id: str | None = None):
    articles = _ticker_articles(ticker)
    if not articles:
        raise HTTPException(404, "No news articles were returned for this ticker.")
    idx = tfidf.build_tfidf_index([a.id for a in articles], [a.full_text for a in articles])
    target_id = article_id
    if target_id is None:
        ticker_articles = [a for a in articles if a.ticker.upper() == ticker.upper()]
        if not ticker_articles:
            raise HTTPException(404, "No articles found for ticker")
        target_id = ticker_articles[-1].id
    doc_index = [a.id for a in articles].index(target_id)
    return {"articleId": target_id, "related": idx.most_similar(doc_index, top_k=4)}


@app.get("/stocks/{ticker}/nlp-intelligence")
def stock_nlp_intelligence(ticker: str):
    """Aggregated endpoint powering the dashboard's NLP Intelligence panel."""
    sentiment_data = stock_sentiment(ticker)
    events_data = stock_events(ticker)
    attention_data = attention.compute_news_attention(ticker)
    topics_data = stock_topics(ticker)
    summary_data = stock_summary(ticker)
    return {
        "ticker": ticker.upper(),
        "sentiment": sentiment_data,
        "topics": topics_data["topics"],
        "events": events_data["events"],
        "summary": summary_data.get("summary"),
        "attention": attention_data,
    }


@app.get("/stocks/{ticker}/attention")
def stock_attention(ticker: str):
    return attention.compute_news_attention(ticker)


# --------------------------------------------------------------------- rag
@app.post("/rag/query")
def rag_query(payload: RagQueryIn):
    return rag.answer_query(payload.query, ticker=payload.ticker, top_k=payload.top_k, generate=payload.generate)
