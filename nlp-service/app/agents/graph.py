from __future__ import annotations

import os
from datetime import datetime
import re
from difflib import SequenceMatcher
from functools import lru_cache
from typing import TypedDict
from uuid import uuid4

import requests
import yfinance as yf
from langchain_core.prompts import ChatPromptTemplate
from langgraph.graph import END, StateGraph

from .. import market_data
from ..pipeline import rag, sentiment, classification, ner, aspect_sentiment, events, tfidf


ALIASES = {
    "nvidia": "NVDA",
    "apple": "AAPL",
    "microsoft": "MSFT",
    "tesla": "TSLA",
    "amazon": "AMZN",
    "infosys": "INFY",
    "reliance industries": "RELIANCE",
    "tata consultancy services": "TCS",
    "tata consultancy": "TCS",
    "hdfc bank": "HDFCBANK",
    "tcs": "TCS",
    "infy": "INFY",
    "reliance": "RELIANCE",
    "hdfc": "HDFCBANK",
    "sbin": "SBIN",
    "alphabet": "GOOGL",
    "google": "GOOGL",
    "meta": "META",
    "facebook": "META",
    "netflix": "NFLX",
    "walmart": "WMT",
    "berkshire hathaway": "BRK-B",
    "jpmorgan": "JPM",
    "jp morgan": "JPM",
    "coca cola": "KO",
    "coca-cola": "KO",
    "intel": "INTC",
    "amd": "AMD",
    "adobe": "ADBE",
    "salesforce": "CRM",
    "oracle": "ORCL",
    "uber": "UBER",
    "airbnb": "ABNB",
    "spotify": "SPOT",
    "paytm": "PAYTM",
    "icici bank": "ICICIBANK",
    "icici": "ICICIBANK",
    "state bank of india": "SBIN",
    "bharti airtel": "BHARTIARTL",
    "larsen and toubro": "LT",
}

_COMPANY_LOOKUP_STOPWORDS = {
    "a", "about", "and", "are", "company", "doing", "for", "how", "is",
    "market", "me", "of", "on", "price", "should", "stock", "tell", "the",
    "that", "this", "it", "what", "will", "with",
}


def _normalise_company_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


@lru_cache(maxsize=256)
def _search_company_symbol(query: str) -> str | None:
    """Resolve a company name through Yahoo's symbol directory.

    The result is deliberately accepted only when the returned equity name is
    close to the query. Yahoo also returns funds, futures, and unrelated
    companies for broad searches.
    """
    try:
        quotes = yf.Search(query, max_results=8).quotes
    except Exception:
        return None

    query_text = _normalise_company_text(query)
    query_symbol = query_text.replace(" ", "").upper()
    query_tokens = set(query_text.split())
    for quote in quotes:
        if quote.get("quoteType") != "EQUITY":
            continue
        symbol = str(quote.get("symbol", "")).upper()
        name = _normalise_company_text(
            str(quote.get("longname") or quote.get("shortname") or "")
        )
        if not re.fullmatch(r"[A-Z0-9.-]{1,20}", symbol) or not name:
            continue
        if query_symbol == symbol:
            return symbol
        name_tokens = set(name.split())
        overlap = len(query_tokens & name_tokens) / max(len(query_tokens), 1)
        similarity = SequenceMatcher(None, query_text, name).ratio()
        first_name = name.split()[0]
        if (
            similarity >= 0.78
            or overlap >= 0.75
            or query_text == first_name
            or query_text.startswith(f"{first_name} ")
        ):
            return symbol
    return None


def _dynamic_company_match(message: str) -> str | None:
    words = re.findall(r"[a-z0-9]+", message.lower())
    candidates: list[str] = []
    for size in range(min(5, len(words)), 0, -1):
        for start in range(len(words) - size + 1):
            phrase_words = words[start : start + size]
            meaningful = [word for word in phrase_words if word not in _COMPANY_LOOKUP_STOPWORDS]
            if not meaningful or (
                len(" ".join(meaningful)) < 4
                and not (size == 1 and len(meaningful[0]) >= 2)
            ):
                continue
            phrase = " ".join(meaningful)
            if phrase not in candidates:
                candidates.append(phrase)
    for candidate in candidates:
        symbol = _search_company_symbol(candidate)
        if symbol:
            return symbol
    return None


def _has_unresolved_company_reference(message: str) -> bool:
    words = re.findall(r"[a-z0-9]+", message.lower())
    meaningful = [word for word in words if word not in _COMPANY_LOOKUP_STOPWORDS]
    return any(len(word) >= 2 for word in meaningful)


class ChatState(TypedDict, total=False):
    message: str
    history: list[dict]
    tickers: list[str]
    market: list[dict]
    news: list[dict]
    nlp: list[dict]
    evidence: dict
    answer: str
    sources: list[dict]
    agents: list[dict]
    verification: dict


def resolve_tickers(message: str, known_symbols: list[str]) -> list[str]:
    found: list[str] = []
    upper = re.findall(r"\b[A-Z][A-Z0-9.-]{1,9}\b", message)
    for symbol in upper:
        if symbol.upper() not in found:
            found.append(symbol.upper())
    lower = message.lower()
    for alias, symbol in ALIASES.items():
        if re.search(rf"\b{re.escape(alias)}\b", lower) and symbol not in found:
            found.append(symbol)
    if not found:
        words = re.findall(r"[a-z0-9]+", lower)
        for size in range(min(5, len(words)), 0, -1):
            for start in range(len(words) - size + 1):
                phrase = " ".join(words[start : start + size])
                match, score = max(
                    (
                        (alias, SequenceMatcher(None, phrase, alias).ratio())
                        for alias in ALIASES
                        if len(alias) >= 4
                    ),
                    key=lambda item: item[1],
                    default=("", 0.0),
                )
                # Require a stronger match for short names to avoid turning
                # ordinary words into tickers.
                threshold = 0.9 if len(match) <= 5 else 0.78
                if match and score >= threshold:
                    found.append(ALIASES[match])
                    break
            if found:
                break
    if not found:
        dynamic_symbol = _dynamic_company_match(message)
        if dynamic_symbol:
            found.append(dynamic_symbol)
    if not found:
        for symbol in known_symbols:
            normalized = symbol.upper()
            if re.search(rf"\b{re.escape(symbol.lower())}\b", lower) and normalized not in found:
                found.append(normalized)
                if len(found) == 3:
                    break
    return found[:3]


AGENT_IDS = {
    "Market Context Agent": "market_context",
    "Financial News Research Agent": "news_research",
    "NLP Analysis Agent": "nlp_analysis",
    "Evidence Retrieval Agent": "evidence_rag",
    "Financial Explanation Agent": "explanation",
    "Verification Agent": "verification",
}


def _agent(name: str, status: str, summary: str) -> dict:
    return {"agent_id": AGENT_IDS[name], "agent_name": name, "description": "", "status": status, "summary": summary, "sources": [], "duration_ms": None}


def market_node(state: ChatState) -> ChatState:
    results = []
    for ticker in state.get("tickers", []):
        try:
            quote = market_data.fetch_quote(ticker)
            history = market_data.fetch_history(ticker, "1M")
            results.append({"ticker": ticker, "quote": quote, "history": history})
        except Exception as exc:
            results.append({"ticker": ticker, "error": str(exc)})
    state["market"] = results
    state.setdefault("agents", []).append(_agent("Market Context Agent", "completed" if results else "insufficient_evidence", f"Retrieved market context for {len(results)} ticker(s)."))
    return state


def news_node(state: ChatState) -> ChatState:
    articles = []
    for ticker in state.get("tickers", []):
        try:
            articles.extend(market_data.fetch_news(ticker, 10))
        except Exception:
            continue
    state["news"] = articles[:6]
    state.setdefault("agents", []).append(_agent("Financial News Research Agent", "completed" if articles else "insufficient_evidence", f"Retrieved {len(articles)} relevant article(s)."))
    return state


def nlp_node(state: ChatState) -> ChatState:
    analyses = []
    for article in state.get("news", [])[:5]:
        text = f"{article['headline']}. {article['text']}"
        analyses.append({
            "id": article["id"],
            "sentiment": sentiment.predict_sentiment(text).__dict__,
            "category": classification.classify_text(text),
            "entities": ner.extract_entities(text),
            "aspects": aspect_sentiment.analyze_aspects(text),
            "events": events.extract_events(text),
            "keyphrases": tfidf.extract_keyphrases(text),
        })
    state["nlp"] = analyses
    state.setdefault("agents", []).append(_agent("NLP Analysis Agent", "completed" if analyses else "insufficient_evidence", f"Analyzed {len(analyses)} article(s)."))
    return state


def rag_node(state: ChatState) -> ChatState:
    try:
        result = rag.answer_query(state["message"], state.get("tickers", [None])[0], 5, generate=False)
    except Exception as exc:
        result = {"answer": "Evidence retrieval was unavailable for this request.", "sources": [], "error": str(exc)}
    if not result.get("sources") and state.get("news"):
        live_sources = [
            {
                "articleId": article.get("id"),
                "headline": article.get("headline", ""),
                "url": article.get("url"),
                "source": article.get("source"),
                "date": article.get("date"),
                "ticker": article.get("ticker"),
            }
            for article in state["news"][:5]
        ]
        result = {
            **result,
            "answer": "Live Yahoo Finance articles were retrieved for this company.",
            "sources": live_sources,
            "retrievedDocuments": live_sources,
            "confidence": 0.5,
            "generation": "live-news-fallback",
        }
    state["evidence"] = result
    state.setdefault("agents", []).append(_agent("Evidence Retrieval Agent", "completed" if result.get("sources") else "insufficient_evidence", f"Retrieved {len(result.get('sources', []))} supporting source(s)."))
    return state


def explanation_node(state: ChatState) -> ChatState:
    def readable_time(value: object) -> str:
        if not isinstance(value, str):
            return "the latest available quote"
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).strftime("%b %-d, %Y at %-I:%M %p")
        except ValueError:
            return "the latest available quote"

    market_lines = []
    market_summary_lines = []
    for item in state.get("market", []):
        quote = item.get("quote", {})
        if quote:
            price = quote.get("price")
            previous_close = quote.get("previousClose")
            change = ""
            if isinstance(price, (int, float)) and isinstance(previous_close, (int, float)) and previous_close:
                change_pct = (price - previous_close) / previous_close * 100
                change = f" ({change_pct:+.2f}% vs previous close)"
            market_lines.append(
                f"{item['ticker']}: {price} {quote.get('currency') or ''}{change} "
                f"as of {readable_time(quote.get('quoteTime'))}."
            )
            market_summary_lines.append(
                f"{item['ticker']} is trading at {price} {quote.get('currency') or ''}"
                f"{change} as of {readable_time(quote.get('quoteTime'))}."
            )
    news_lines = [f"{a['headline']} ({a.get('source')}, {a.get('date')})" for a in state.get("news", [])[:4]]
    prompt = ChatPromptTemplate.from_messages([
        ("system", "You are PulseWatch AI. Answer clearly in under 120 words using only the supplied evidence. Do not invent facts. Say when evidence is missing."),
        ("human", "Question: {question}\nMarket:\n{market}\nNews:\n{news}\nEvidence:\n{evidence}"),
    ])
    rendered = prompt.format_messages(
        question=state["message"],
        market="\n".join(market_lines) or "No market data.",
        news="\n".join(news_lines) or "No relevant news found.",
        evidence=state.get("evidence", {}).get("answer", "No additional evidence."),
    )
    evidence = state.get("evidence", {})
    answer = evidence.get("answer", "")
    if not evidence.get("sources") and market_lines:
        answer = (
            " ".join(market_summary_lines)
            + " No matching news was available, so I cannot attribute the move "
            "to a specific event."
        )
    elif market_lines and answer.startswith("Based on "):
        answer = (
            " ".join(market_lines)
            + "\n\nRecent evidence: "
            + answer.removeprefix("Based on ")
        )
    api_key = os.environ.get("GROQ_API_KEY")
    if api_key and (not market_lines or evidence.get("sources")):
        try:
            response = requests.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"model": os.environ.get("CHAT_LLM_MODEL", "llama-3.3-70b-versatile"), "temperature": 0.2, "max_tokens": 300, "messages": [{"role": "system", "content": rendered[0].content}, {"role": "user", "content": rendered[1].content}]},
                timeout=20,
            )
            response.raise_for_status()
            generated = response.json()["choices"][0]["message"]["content"].strip()
            if generated and not (
                market_lines
                and re.search(r"\b(no|not enough|insufficient|does not contain)\b", generated, re.IGNORECASE)
            ):
                answer = generated
        except (requests.RequestException, KeyError, IndexError, TypeError):
            pass
    if not answer:
        answer = "No usable evidence was found for this question."
    state["answer"] = answer
    state.setdefault("agents", []).append(_agent("Financial Explanation Agent", "completed", "Produced an evidence-grounded answer."))
    return state


def verification_node(state: ChatState) -> ChatState:
    sources = state.get("evidence", {}).get("sources", [])
    usable_market = [item for item in state.get("market", []) if item.get("quote")]
    issues = [] if sources or usable_market else [{"severity": "warning", "code": "missing_evidence", "message": "No supporting market or news evidence was found."}]
    state["verification"] = {"status": "passed" if not issues else "passed_with_warnings", "issues": issues}
    state.setdefault("agents", []).append(_agent("Verification Agent", "completed", "Checked the available evidence."))
    return state


def build_graph():
    graph = StateGraph(ChatState)
    graph.add_node("market_context", market_node)
    graph.add_node("news_research", news_node)
    graph.add_node("nlp_analysis", nlp_node)
    graph.add_node("evidence_rag", rag_node)
    graph.add_node("explanation", explanation_node)
    graph.add_node("verify_answer", verification_node)
    graph.set_entry_point("market_context")
    graph.add_edge("market_context", "news_research")
    graph.add_edge("news_research", "nlp_analysis")
    graph.add_edge("nlp_analysis", "evidence_rag")
    graph.add_edge("evidence_rag", "explanation")
    graph.add_edge("explanation", "verify_answer")
    graph.add_edge("verify_answer", END)
    return graph.compile()


chat_graph = build_graph()


def run_graph(message: str, history: list[dict] | None = None, known_symbols: list[str] | None = None) -> dict:
    turns = history or []
    tickers = resolve_tickers(message, known_symbols or [])
    unresolved = not tickers and _has_unresolved_company_reference(message)
    if not tickers and not unresolved:
        for turn in reversed(turns):
            previous_tickers = turn.get("tickers")
            if isinstance(previous_tickers, list) and previous_tickers:
                tickers = [str(ticker).upper() for ticker in previous_tickers[:3]]
                break
    if unresolved and not tickers:
        return {
            "conversation_id": str(uuid4()),
            "answer": "I couldn't identify that company or ticker. Please check the spelling and try again.",
            "agents": [],
            "sources": [],
            "data_freshness": {"generated_at": "", "market": [], "news": None},
            "verification": {
                "status": "passed_with_warnings",
                "issues": [{
                    "severity": "warning",
                    "code": "unrecognized_company",
                    "message": "No company or ticker could be identified from the request.",
                }],
            },
            "generation": {"mode": "fallback", "provider": None, "model": None, "reason": "unrecognized_company"},
            "tickers": [],
        }
    result = chat_graph.invoke({"message": message, "history": turns, "tickers": tickers, "agents": []})
    sources = result.get("evidence", {}).get("sources", [])
    market_freshness = []
    for item in result.get("market", []):
        quote = item.get("quote")
        if quote:
            market_freshness.append({
                "symbol": item["ticker"],
                "data_type": "delayed",
                "provider": "Yahoo Finance",
                "as_of": quote.get("quoteTime"),
                "age_seconds": None,
                "note": "Yahoo Finance quotes may be delayed.",
            })
        else:
            market_freshness.append({
                "symbol": item["ticker"],
                "data_type": "unavailable",
                "provider": "Yahoo Finance",
                "as_of": None,
                "age_seconds": None,
                "note": "Yahoo Finance did not return a quote.",
            })
    return {
        "conversation_id": str(uuid4()),
        "answer": result.get("answer", ""),
        "agents": result.get("agents", []),
        "sources": [{"ref": str(i + 1), "type": "article", "title": source.get("headline", ""), "url": source.get("url"), "provider": source.get("source"), "article_id": source.get("articleId"), "published_at": source.get("date"), "ticker": source.get("ticker"), "cited": True} for i, source in enumerate(sources)],
        "data_freshness": {"generated_at": "", "market": market_freshness, "news": None},
        "verification": result.get("verification", {"status": "not_run", "issues": []}),
        "generation": {"mode": "llm" if os.environ.get("GROQ_API_KEY") else "fallback", "provider": "groq" if os.environ.get("GROQ_API_KEY") else None, "model": os.environ.get("CHAT_LLM_MODEL") if os.environ.get("GROQ_API_KEY") else None, "reason": None},
        "tickers": tickers,
    }
