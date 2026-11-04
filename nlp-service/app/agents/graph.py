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
    "that", "this", "it", "its", "their", "what", "will", "with",
    "news", "latest", "recent", "more", "again", "why", "does", "did",
    "can", "give", "show", "explain", "move", "moving", "today",
    "sentiment", "events", "trading", "worth", "recommendation", "buy",
    "sell", "hold",
}
_COMMON_WORD_TICKERS = {
    "AN", "AM", "AS", "AT", "BE", "BY", "DO", "GO", "IF", "IN", "IS",
    "IT", "ME", "MY", "NO", "OF", "ON", "OR", "SO", "TO", "UP", "US",
    "WE", "WHY", "YES", "YOU",
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
            if phrase.upper() in _COMMON_WORD_TICKERS:
                continue
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


def _is_purchase_question(message: str) -> bool:
    lower = message.lower()
    purchase_words = ("buy", "purchase", "invest", "add to my position", "buy more")
    decision_words = ("should", "would", "can", "is it", "worth", "good idea")
    return any(word in lower for word in purchase_words) and (
        "more" in lower or any(word in lower for word in decision_words)
    )


def _is_portfolio_recommendation(message: str) -> bool:
    lower = message.lower()
    broad_terms = (
        "what companies",
        "which companies",
        "what stocks",
        "which stocks",
        "companies should",
        "stocks should",
        "invest into",
        "invest in",
        "recommend",
        "portfolio",
        "diversify",
        "new stocks",
        "new companies",
        "suggest me",
        "recommend me",
        "what should i buy",
        "what should i invest",
        "where should i invest",
        "stocks to buy",
        "stock to buy",
    )
    return any(term in lower for term in broad_terms)


def _is_greeting(message: str) -> bool:
    return message.lower().strip().rstrip("!?.,") in {
        "hi",
        "hello",
        "hey",
        "good morning",
        "good afternoon",
        "good evening",
    }


def _is_holdings_comparison(message: str) -> bool:
    lower = message.lower()
    holdings_terms = (
        "my portfolio",
        "my holdings",
        "stocks i own",
        "stocks that i own",
        "currently own",
        "currently track",
        "existing holdings",
        "what should i do with",
    )
    return any(term in lower for term in holdings_terms)


def _is_memory_question(message: str) -> bool:
    lower = message.lower().strip()
    return any(
        phrase in lower
        for phrase in (
            "what was my previous question",
            "my previous question",
            "previous question",
            "what did i ask",
            "what did i say",
            "what were we discussing",
            "remind me what i asked",
        )
    )


def _is_horizon_followup(message: str) -> bool:
    lower = message.lower().strip()
    return (
        len(lower.split()) <= 8
        and any(term in lower for term in ("short term", "short-term", "long term", "long-term"))
    )


def _requested_horizon(message: str) -> str:
    lower = message.lower()
    return "long_term" if "long term" in lower or "long-term" in lower else "short_term"


def _is_quote_question(message: str) -> bool:
    lower = message.lower()
    return any(
        phrase in lower
        for phrase in (
            "trading at",
            "current price",
            "share price",
            "stock price",
            "what is the price",
            "quote",
        )
    )


_RECOMMENDATION_UNIVERSE = (
    "AAPL",
    "MSFT",
    "NVDA",
    "GOOGL",
    "AMZN",
    "JPM",
    "TCS.NS",
    "INFY.NS",
    "RELIANCE.NS",
)


def _dynamic_recommendation_universe(excluded: set[str]) -> list[str]:
    candidates: list[str] = []
    try:
        for screen_name in ("day_gainers", "growth_technology_stocks", "most_actives"):
            quotes = yf.screen(screen_name, count=30).get("quotes", [])
            for quote in quotes:
                symbol = str(quote.get("symbol", "")).upper()
                if (
                    symbol
                    and "." not in symbol
                    and quote.get("quoteType") == "EQUITY"
                    and symbol not in excluded
                    and symbol not in candidates
                ):
                    candidates.append(symbol)
                if len(candidates) >= 12:
                    return candidates
    except Exception:
        logger.warning("Dynamic chatbot recommendation universe was unavailable", exc_info=True)
    return [
        symbol for symbol in _RECOMMENDATION_UNIVERSE
        if symbol not in excluded
    ]


def _recommendation_sentence(
    ticker: str,
    decision: str,
    trend: str,
    owned: bool,
    question: str,
) -> str:
    lower = question.lower()
    if owned and ("buy" in lower or "purchase" in lower or "add" in lower):
        if decision == "consider":
            action = f"Since you already own {ticker}, I would suggest adding to your position"
        elif decision == "avoid":
            action = f"Since you already own {ticker}, I would suggest holding it for now instead of buying more"
        else:
            action = f"Since you already own {ticker}, I would suggest holding it for now"
    elif "sell" in lower:
        action = (
            "I would suggest selling this stock"
            if decision == "avoid" and owned
            else "I would suggest holding this stock for now"
        )
    elif owned:
        action = "I would suggest holding this stock for now"
    elif "hold" in lower or "keep" in lower:
        action = "I would suggest holding this stock for now"
    elif decision == "consider":
        action = f"I would suggest buying {ticker}"
    elif decision == "avoid":
        action = f"I would wait before buying {ticker}"
    else:
        action = f"I would wait before making a decision on {ticker}"
    ownership = "" if owned else f" {ticker} is not currently in your holdings."
    return f"{action}. {trend.capitalize()}.{ownership}"


def _forecast_signals(
    closes: list[float],
    horizon: str = "short_term",
) -> tuple[str, str, float]:
    if len(closes) < 10:
        return "flat", "low", 0.0

    def change(window: int) -> float:
        values = closes[-window:] if len(closes) >= window else closes
        return (values[-1] - values[0]) / values[0] * 100

    if horizon == "long_term":
        one_year = change(12)
        three_year = change(36)
        five_year = change(60)
        score = one_year * 0.20 + three_year * 0.30 + five_year * 0.50
    else:
        one_month = change(22)
        three_month = change(63)
        recent = change(10)
        score = one_month * 0.45 + three_month * 0.35 + recent * 0.20
    returns = [
        (closes[index] - closes[index - 1]) / closes[index - 1] * 100
        for index in range(1, len(closes))
        if closes[index - 1]
    ]
    average = sum(returns) / len(returns) if returns else 0.0
    volatility = (
        sum((value - average) ** 2 for value in returns) / len(returns)
    ) ** 0.5 if returns else 0.0
    if volatility > 4:
        score *= 0.75
    direction = "up" if score > 1 else "down" if score < -1 else "flat"
    confidence = "moderate" if abs(score) >= 3 and volatility < 5 else "low"
    return direction, confidence, score


def _signal_agreement(
    direction: str,
    headlines: list[str],
) -> str:
    positive = ("growth", "record", "profit", "upgrade", "demand", "strong", "surge")
    negative = ("loss", "downgrade", "lawsuit", "weak", "cut", "decline", "risk")
    text = " ".join(headlines).lower()
    positive_count = sum(text.count(word) for word in positive)
    negative_count = sum(text.count(word) for word in negative)
    if not text or positive_count == negative_count:
        return "there is no clear news signal"
    news_direction = "up" if positive_count > negative_count else "down"
    if direction == "flat":
        return f"news points {news_direction}, while the price forecast is flat"
    if news_direction == direction:
        return f"recent news supports the {direction} forecast"
    return f"recent news points {news_direction}, which conflicts with the price forecast"


def _clean_chat_answer(answer: str) -> str:
    """Keep chatbot output as plain, readable text instead of markdown."""
    cleaned = answer.replace("**", "").replace("__", "").replace("`", "")
    cleaned = re.sub(r"^#{1,6}\s*", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"^[ \t]*[-*][ \t]+", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


class ChatState(TypedDict, total=False):
    message: str
    history: list[dict]
    owned_symbols: list[str]
    horizon: str
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
        if symbol.upper() in _COMMON_WORD_TICKERS:
            continue
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
    history_range = "5Y" if state.get("horizon") == "long_term" else "3M"
    for ticker in state.get("tickers", []):
        try:
            quote = market_data.fetch_quote(ticker)
            history = market_data.fetch_history(ticker, history_range)
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
    buy_guidance_lines = []
    portfolio_lines = []
    owned_symbols = {symbol.upper() for symbol in state.get("owned_symbols", [])}
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
            closes = [
                float(bar["close"])
                for bar in item.get("history", [])
                if isinstance(bar.get("close"), (int, float)) and bar["close"] > 0
            ]
            forecast_direction, forecast_confidence, forecast_score = _forecast_signals(
                closes,
                state.get("horizon", "short_term"),
            )
            ticker_news = [
                str(article.get("headline", ""))
                for article in state.get("news", [])
                if str(article.get("ticker", "")).upper() == item["ticker"].upper()
            ]
            agreement = _signal_agreement(forecast_direction, ticker_news)
            owned = item["ticker"].upper() in owned_symbols
            decision = (
                "consider" if forecast_direction == "up"
                else "avoid" if forecast_direction == "down"
                else "wait"
            )
            horizon_label = (
                "over the next 1 to 5 years"
                if state.get("horizon") == "long_term"
                else "over the next 1 to 3 months"
            )
            trend = (
                f"{horizon_label}, the forecast is {forecast_direction} "
                f"with {forecast_confidence} confidence, and {agreement}"
            )
            if owned and not (
                forecast_direction == "down" and forecast_confidence == "moderate"
            ):
                decision = "wait"
            buy_guidance_lines.append(
                _recommendation_sentence(
                    item["ticker"],
                    decision,
                    trend,
                    owned,
                    state["message"],
                )
            )
            if _is_portfolio_recommendation(state["message"]) or _is_horizon_followup(state["message"]):
                if (
                    decision != "consider"
                    and not _is_holdings_comparison(state["message"])
                ):
                    continue
                portfolio_lines.append(
                    _recommendation_sentence(
                        item["ticker"],
                        decision,
                        f"{trend}. Recent news coverage: {len(ticker_news)} article(s)",
                        owned,
                        state["message"],
                    )
                )
    news_lines = [f"{a['headline']} ({a.get('source')}, {a.get('date')})" for a in state.get("news", [])[:4]]
    history_lines = []
    for turn in state.get("history", [])[-6:]:
        role = turn.get("role")
        content = turn.get("content")
        if role in {"user", "assistant"} and isinstance(content, str) and content.strip():
            history_lines.append(f"{role.title()}: {content[:1200]}")
    prompt = ChatPromptTemplate.from_messages([
        ("system", "You are PulseWatch AI. Speak naturally and conversationally, like a helpful market assistant. For portfolio questions, give a detailed comparison of every supplied stock and explain the reason for each recommendation. Use only the supplied evidence. Use the recent conversation to understand short follow-up questions and pronouns. The ownership context tells you whether the user already holds the stock. If the user asks whether to buy, sell, or hold, answer that decision directly and explain which supplied facts support it. Do not invent facts. Say when evidence is missing."),
        ("human", "Recent conversation:\n{history}\n\nQuestion: {question}\nMarket:\n{market}\nDecision guidance:\n{guidance}\nOwned stocks:\n{owned}\nNews:\n{news}\nEvidence:\n{evidence}"),
    ])
    rendered = prompt.format_messages(
        history="\n".join(history_lines) or "No earlier turns.",
        question=state["message"],
        market="\n".join(market_lines) or "No market data.",
        guidance="\n".join(buy_guidance_lines) or "No buy decision requested.",
        owned=", ".join(sorted(owned_symbols)) or "No owned stocks were found.",
        news="\n".join(news_lines) or "No relevant news found.",
        evidence=state.get("evidence", {}).get("answer", "No additional evidence."),
    )
    evidence = state.get("evidence", {})
    answer = evidence.get("answer", "")
    if _is_quote_question(state["message"]) and market_lines:
        answer = " ".join(market_summary_lines)
        if evidence.get("answer"):
            answer += " " + str(evidence["answer"]).removeprefix("Based on ").strip()
    elif not evidence.get("sources") and market_lines:
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
    if portfolio_lines:
        ownership_note = (
            " Since you already own some stocks, I left those out of this list."
            if owned_symbols
            else ""
        )
        answer = (
            "Here are the stocks I would consider for you:\n\n"
            + "\n".join(
                f"{index}. {line}" for index, line in enumerate(portfolio_lines, start=1)
            )
            + "\n\nI ranked these using the forecast across several time periods and the available news."
            + ownership_note
        )
    elif (
        (_is_portfolio_recommendation(state["message"]) or _is_horizon_followup(state["message"]))
        and not buy_guidance_lines
    ):
        answer = (
            "I did not find a stock with a strong enough positive forecast for "
            f"the {_requested_horizon(state['message']).replace('_', ' ')} view. "
            "I would rather wait than recommend a stock with weakening evidence."
        )
    elif (
        buy_guidance_lines
        and (
            _is_purchase_question(state["message"])
            or _is_holdings_comparison(state["message"])
        )
    ):
        answer = " ".join(buy_guidance_lines)
    api_key = os.environ.get("GROQ_API_KEY")
    if api_key and market_lines:
        try:
            response = requests.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"model": os.environ.get("CHAT_LLM_MODEL", "llama-3.3-70b-versatile"), "temperature": 0.2, "max_tokens": 500, "messages": [{"role": "system", "content": rendered[0].content + " Answer naturally, as a continuing conversation. For a stock suggestion request, recommend only stocks marked as buyable in Decision guidance, explain each briefly, and mention when none qualify. Do not output a generic market report."}, {"role": "user", "content": rendered[1].content}]},
                timeout=20,
            )
            response.raise_for_status()
            generated = response.json()["choices"][0]["message"]["content"].strip()
            if generated:
                answer = generated
        except (requests.RequestException, KeyError, IndexError, TypeError):
            pass
    if not answer:
        answer = "No usable evidence was found for this question."
    answer = _clean_chat_answer(answer)
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


def run_graph(
    message: str,
    history: list[dict] | None = None,
    known_symbols: list[str] | None = None,
    owned_symbols: list[str] | None = None,
) -> dict:
    turns = history or []
    if _is_greeting(message):
        return {
            "conversation_id": str(uuid4()),
            "answer": "Hello. I can help with stock prices, market news, portfolio decisions, and buy or hold suggestions. Which stock or decision would you like to discuss?",
            "agents": [],
            "sources": [],
            "data_freshness": {"generated_at": "", "market": [], "news": None},
            "verification": {"status": "passed", "issues": []},
            "generation": {"mode": "conversation", "provider": None, "model": None, "reason": None},
            "tickers": [],
        }
    if _is_memory_question(message):
        previous_question = next(
            (
                str(turn.get("content", "")).strip()
                for turn in reversed(turns)
                if turn.get("role") == "user" and str(turn.get("content", "")).strip()
            ),
            None,
        )
        answer = (
            f"Your previous question was: “{previous_question}”"
            if previous_question
            else "This is the first question in the current conversation."
        )
        return {
            "conversation_id": str(uuid4()),
            "answer": answer,
            "agents": [],
            "sources": [],
            "data_freshness": {"generated_at": "", "market": [], "news": None},
            "verification": {"status": "passed", "issues": []},
            "generation": {"mode": "conversation_memory", "provider": None, "model": None, "reason": None},
            "tickers": [],
        }

    previous_tickers = next(
        (
            [str(ticker).upper() for ticker in turn.get("tickers", [])[:9]]
            for turn in reversed(turns)
            if isinstance(turn.get("tickers"), list) and turn.get("tickers")
        ),
        [],
    )
    current_tickers = resolve_tickers(message, known_symbols or [])
    purchase_decision = _is_purchase_question(message) and (
        bool(current_tickers) or bool(previous_tickers)
    )
    horizon_followup = _is_horizon_followup(message) and bool(previous_tickers)
    portfolio_question = (
        not purchase_decision
        and (_is_portfolio_recommendation(message) or horizon_followup)
    )
    if portfolio_question:
        tracked = list(dict.fromkeys(
            str(symbol).upper()
            for symbol in (owned_symbols or known_symbols or [])
        ))
        wants_new = (
            not horizon_followup
            and (
                "new" in message.lower()
            or not _is_holdings_comparison(message)
            )
        )
        if horizon_followup:
            tickers = previous_tickers
        else:
            candidates = (
                _dynamic_recommendation_universe(set(tracked))
                if wants_new
                else [symbol for symbol in tracked]
            )
            tickers = list(dict.fromkeys(
                (candidates if wants_new else tracked)
            ))[:9]
    elif purchase_decision:
        # A question such as "should I invest in it?" is a decision about the
        # subject of the preceding turn, not a request for a new stock list.
        tickers = current_tickers or previous_tickers
    else:
        tickers = current_tickers
    unresolved = (
        not tickers
        and not portfolio_question
        and _has_unresolved_company_reference(message)
    )
    if portfolio_question and not tickers:
        return {
            "conversation_id": str(uuid4()),
            "answer": "I do not have any stocks from your portfolio to compare yet. Add stocks to your holdings and I can compare them for you.",
            "agents": [],
            "sources": [],
            "data_freshness": {"generated_at": "", "market": [], "news": None},
            "verification": {
                "status": "passed_with_warnings",
                "issues": [{
                    "severity": "warning",
                    "code": "no_portfolio_stocks",
                    "message": "No portfolio stocks were supplied for comparison.",
                }],
            },
            "generation": {"mode": "fallback", "provider": None, "model": None, "reason": "no_portfolio_stocks"},
            "tickers": [],
        }
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
    result = chat_graph.invoke({
        "message": message,
        "history": turns,
        "tickers": tickers,
        "owned_symbols": owned_symbols or [],
        "horizon": _requested_horizon(message),
        "agents": [],
    })
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
