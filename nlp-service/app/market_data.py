from __future__ import annotations

import logging
import math
import re
import hashlib
import warnings
from datetime import datetime, timezone
from typing import Any

import pandas as pd
import yfinance as yf

logger = logging.getLogger(__name__)
warnings.filterwarnings(
    "ignore",
    message=".*inplace keyword in DataFrame\\.set_index is deprecated.*",
)

_NSE_SYMBOLS = {
    "RELIANCE",
    "TCS",
    "INFY",
    "HDFCBANK",
    "ICICIBANK",
    "SBIN",
    "ITC",
    "BHARTIARTL",
    "LT",
    "MARUTI",
}

_HISTORY_RANGES = {
    "1D": ("1d", "5m"),
    "1W": ("5d", "30m"),
    "1M": ("1mo", "1d"),
    "3M": ("3mo", "1d"),
    "1Y": ("1y", "1wk"),
    "5Y": ("5y", "1mo"),
}


def normalize_yahoo_symbol(ticker: str) -> str:
    symbol = ticker.strip().upper()
    if not re.fullmatch(r"[A-Z0-9.-]{1,20}", symbol):
        raise ValueError("Ticker may only contain letters, numbers, '.' and '-'.")
    if "." not in symbol and symbol in _NSE_SYMBOLS:
        return f"{symbol}.NS"
    return symbol


def _fast_info_value(info: Any, key: str) -> Any:
    try:
        return info.get(key)
    except Exception:
        logger.warning("Yahoo Finance metadata field %s was unavailable", key, exc_info=True)
        return None


def fetch_quote(ticker: str) -> dict[str, Any]:
    yahoo_symbol = normalize_yahoo_symbol(ticker)
    stock = yf.Ticker(yahoo_symbol)
    history = stock.history(
        period="1d",
        interval="1m",
        prepost=False,
        auto_adjust=False,
        actions=False,
        timeout=15,
    )
    if history.empty:
        # Some exchanges do not expose intraday bars consistently. A daily
        # fallback still provides a valid latest quote for those companies.
        history = stock.history(
            period="5d",
            interval="1d",
            prepost=False,
            auto_adjust=False,
            actions=False,
            timeout=15,
        )
    if history.empty:
        raise LookupError(f"Yahoo Finance returned no quote for {ticker.upper()}.")

    latest = history.iloc[-1]
    price = float(latest["Close"])
    if not math.isfinite(price) or price <= 0:
        raise LookupError(f"Yahoo Finance returned an invalid quote for {ticker.upper()}.")

    quote_time = history.index[-1].to_pydatetime().isoformat()
    info = stock.fast_info
    volume = _fast_info_value(info, "lastVolume")
    average_volume = _fast_info_value(info, "threeMonthAverageVolume")
    previous_close = _fast_info_value(info, "previousClose")

    return {
        "symbol": ticker.strip().upper(),
        "price": price,
        "currency": _fast_info_value(info, "currency"),
        "exchange": _fast_info_value(info, "exchange"),
        "quoteTime": quote_time,
        "volume": int(volume) if isinstance(volume, (int, float)) and math.isfinite(volume) else None,
        "avgVolume": int(average_volume)
        if isinstance(average_volume, (int, float)) and math.isfinite(average_volume)
        else None,
        "previousClose": float(previous_close)
        if isinstance(previous_close, (int, float)) and math.isfinite(previous_close) and previous_close > 0
        else None,
    }


def fetch_history(ticker: str, range_name: str) -> list[dict[str, Any]]:
    yahoo_symbol = normalize_yahoo_symbol(ticker)
    if range_name not in _HISTORY_RANGES:
        raise ValueError("Range must be one of 1D, 1W, 1M, 3M, 1Y, or 5Y.")
    period, interval = _HISTORY_RANGES[range_name]
    history = yf.Ticker(yahoo_symbol).history(
        period=period,
        interval=interval,
        prepost=False,
        auto_adjust=False,
        actions=False,
        timeout=15,
    )

    bars: list[dict[str, Any]] = []
    for timestamp, row in history.iterrows():
        values = {
            "open": float(row["Open"]),
            "high": float(row["High"]),
            "low": float(row["Low"]),
            "close": float(row["Close"]),
        }
        if not all(math.isfinite(value) for value in values.values()):
            continue
        volume = row.get("Volume")
        bars.append(
            {
                "timestamp": timestamp.to_pydatetime().isoformat(),
                **values,
                "volume": int(volume)
                if isinstance(volume, (int, float)) and math.isfinite(volume)
                else None,
            }
        )
    return bars


def fetch_news(ticker: str, count: int = 20) -> list[dict[str, str]]:
    yahoo_symbol = normalize_yahoo_symbol(ticker)
    try:
        news = yf.Ticker(yahoo_symbol).get_news(count=count)
    except Exception as err:
        logger.warning(
            "Yahoo news unavailable for %s: %s",
            yahoo_symbol,
            type(err).__name__,
        )
        news = []
    if not news:
        logger.info(
            "Yahoo ticker news was empty for %s; querying Yahoo Finance search news",
            yahoo_symbol,
        )
        # Search is more reliable with an explicit stock query. For exchange
        # symbols, retry the normalized form so Yahoo can match the listing.
        queries = (f"{yahoo_symbol} stock", yahoo_symbol)
        for query in dict.fromkeys(queries):
            try:
                news = yf.Search(query, news_count=count).news
            except Exception as err:
                logger.warning(
                    "Yahoo news search unavailable for %s: %s",
                    query,
                    type(err).__name__,
                )
                news = []
            if news:
                break
    articles: list[dict[str, str]] = []

    for item in news:
        content = item.get("content", item)
        if not isinstance(content, dict):
            continue

        headline = content.get("title") or item.get("title")
        if not isinstance(headline, str) or not headline.strip():
            continue
        related_tickers = item.get("relatedTickers")
        if (
            isinstance(related_tickers, list)
            and related_tickers
            and yahoo_symbol not in {str(symbol).upper() for symbol in related_tickers}
        ):
            continue

        summary = content.get("summary") or content.get("description") or ""
        text = summary.strip() if isinstance(summary, str) else ""
        canonical_url = content.get("canonicalUrl") or content.get("clickThroughUrl")
        url = canonical_url.get("url", "") if isinstance(canonical_url, dict) else ""
        url = url or content.get("link") or item.get("link") or ""

        provider = content.get("provider") or item.get("publisher") or {}
        source = provider.get("displayName", "") if isinstance(provider, dict) else str(provider)

        published = content.get("pubDate") or content.get("displayTime")
        if not published:
            timestamp = item.get("providerPublishTime")
            if isinstance(timestamp, (int, float)):
                published = datetime.fromtimestamp(timestamp, timezone.utc).isoformat()
        if not isinstance(published, str):
            published = ""

        stable_key = str(content.get("id") or item.get("uuid") or url or f"{headline}:{published}")
        article_id = hashlib.sha256(f"{yahoo_symbol}:{stable_key}".encode()).hexdigest()[:24]
        articles.append({
            "id": article_id,
            "headline": headline.strip(),
            "text": text or headline.strip(),
            "date": published,
            "source": str(source),
            "ticker": ticker.strip().upper(),
            "url": str(url),
        })

    return articles
