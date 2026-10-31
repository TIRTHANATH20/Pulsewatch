import sys
from pathlib import Path
from unittest.mock import Mock, call

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import market_data


def test_normalize_yahoo_symbol_maps_known_nse_tickers():
    assert market_data.normalize_yahoo_symbol("tcs") == "TCS.NS"
    assert market_data.normalize_yahoo_symbol("AAPL") == "AAPL"
    assert market_data.normalize_yahoo_symbol("RELIANCE.BO") == "RELIANCE.BO"


def test_fetch_quote_uses_daily_fallback_when_intraday_is_empty(monkeypatch):
    from app import market_data

    calls = []

    class FakeStock:
        fast_info = {"currency": "USD", "exchange": "NMS", "previousClose": 100.0}

        def history(self, **kwargs):
            calls.append(kwargs["interval"])
            if kwargs["interval"] == "1m":
                return market_data.pd.DataFrame()
            return market_data.pd.DataFrame(
                {"Close": [101.0]},
                index=market_data.pd.to_datetime(["2026-10-30"]),
            )

    monkeypatch.setattr(market_data.yf, "Ticker", lambda symbol: FakeStock())

    quote = market_data.fetch_quote("JPM")

    assert calls == ["1m", "1d"]
    assert quote["price"] == 101.0


@pytest.mark.parametrize("ticker", ["", "TCS/../etc", "TCS?interval=1d"])
def test_normalize_yahoo_symbol_rejects_invalid_tickers(ticker):
    with pytest.raises(ValueError):
        market_data.normalize_yahoo_symbol(ticker)


def test_fetch_quote_uses_yfinance_and_returns_latest_price(monkeypatch):
    index = pd.DatetimeIndex(["2026-10-23 15:28:00"], tz="Asia/Kolkata")
    history = pd.DataFrame(
        {
            "Open": [2529.0],
            "High": [2531.0],
            "Low": [2528.0],
            "Close": [2530.0],
            "Volume": [86800],
        },
        index=index,
    )
    stock = Mock(
        history=Mock(return_value=history),
        fast_info={
            "currency": "INR",
            "exchange": "NSI",
            "lastVolume": 6857942,
            "threeMonthAverageVolume": 4068822,
        },
    )
    ticker = Mock(return_value=stock)
    monkeypatch.setattr(market_data.yf, "Ticker", ticker)

    result = market_data.fetch_quote("TCS")

    ticker.assert_called_once_with("TCS.NS")
    stock.history.assert_called_once_with(
        period="1d",
        interval="1m",
        prepost=False,
        auto_adjust=False,
        actions=False,
        timeout=15,
    )
    assert result == {
        "symbol": "TCS",
        "price": 2530.0,
        "currency": "INR",
        "exchange": "NSI",
        "quoteTime": "2026-10-23T15:28:00+05:30",
        "volume": 6857942,
        "avgVolume": 4068822,
        "previousClose": None,
    }


def test_fetch_quote_reports_empty_history(monkeypatch):
    stock = Mock(history=Mock(return_value=pd.DataFrame()), fast_info={})
    monkeypatch.setattr(market_data.yf, "Ticker", Mock(return_value=stock))

    with pytest.raises(LookupError, match="no quote"):
        market_data.fetch_quote("TCS")


def test_fetch_history_returns_only_valid_bars(monkeypatch):
    index = pd.DatetimeIndex(
        ["2026-10-22 15:25:00", "2026-10-23 15:25:00"], tz="Asia/Kolkata"
    )
    history = pd.DataFrame(
        {
            "Open": [2500.0, 2520.0],
            "High": [2510.0, 2535.0],
            "Low": [2490.0, 2515.0],
            "Close": [2505.0, 2530.0],
            "Volume": [1000, 86800],
        },
        index=index,
    )
    stock = Mock(history=Mock(return_value=history))
    ticker = Mock(return_value=stock)
    monkeypatch.setattr(market_data.yf, "Ticker", ticker)

    bars = market_data.fetch_history("TCS", "1D")

    ticker.assert_called_once_with("TCS.NS")
    stock.history.assert_called_once_with(
        period="1d",
        interval="5m",
        prepost=False,
        auto_adjust=False,
        actions=False,
        timeout=15,
    )
    assert len(bars) == 2
    assert bars[1] == {
        "timestamp": "2026-10-23T15:25:00+05:30",
        "open": 2520.0,
        "high": 2535.0,
        "low": 2515.0,
        "close": 2530.0,
        "volume": 86800,
    }


def test_fetch_history_rejects_unknown_ranges():
    with pytest.raises(ValueError, match="Range must"):
        market_data.fetch_history("TCS", "2D")


def test_fetch_news_normalizes_current_yahoo_response(monkeypatch):
    news = [
        {
            "content": {
                "id": "article-1",
                "title": "Company reports quarterly results",
                "summary": "Revenue increased during the quarter.",
                "pubDate": "2026-10-23T10:00:00Z",
                "canonicalUrl": {"url": "https://news.example/article-1"},
                "provider": {"displayName": "Financial News"},
            },
        },
    ]
    stock = Mock(get_news=Mock(return_value=news))
    ticker = Mock(return_value=stock)
    monkeypatch.setattr(market_data.yf, "Ticker", ticker)

    result = market_data.fetch_news("TCS")

    ticker.assert_called_once_with("TCS.NS")
    stock.get_news.assert_called_once_with(count=20)
    assert result == [{
        "id": result[0]["id"],
        "headline": "Company reports quarterly results",
        "text": "Revenue increased during the quarter.",
        "date": "2026-10-23T10:00:00Z",
        "source": "Financial News",
        "ticker": "TCS",
        "url": "https://news.example/article-1",
    }]


def test_fetch_news_supports_legacy_yahoo_response(monkeypatch):
    stock = Mock(get_news=Mock(return_value=[{
        "uuid": "legacy-1",
        "title": "Market update",
        "link": "https://news.example/legacy-1",
        "publisher": "Market Publisher",
        "providerPublishTime": 1792759200,
    }]))
    monkeypatch.setattr(market_data.yf, "Ticker", Mock(return_value=stock))

    result = market_data.fetch_news("AAPL")

    assert result[0]["headline"] == "Market update"
    assert result[0]["text"] == "Market update"
    assert result[0]["source"] == "Market Publisher"
    assert result[0]["url"] == "https://news.example/legacy-1"
    assert result[0]["ticker"] == "AAPL"
    assert result[0]["date"]


def test_fetch_news_uses_yahoo_search_when_ticker_news_is_empty(monkeypatch):
    stock = Mock(get_news=Mock(return_value=[]))
    monkeypatch.setattr(market_data.yf, "Ticker", Mock(return_value=stock))
    search = Mock(
        news=[
            {
                "uuid": "search-1",
                "title": "NVIDIA announces quarterly results",
                "link": "https://news.example/nvidia-results",
                "publisher": "Financial News",
                "providerPublishTime": 1792759200,
                "relatedTickers": ["NVDA", "SMH"],
            },
            {
                "uuid": "unrelated",
                "title": "Apple announces quarterly results",
                "link": "https://news.example/apple-results",
                "publisher": "Financial News",
                "providerPublishTime": 1792759200,
                "relatedTickers": ["AAPL"],
            },
        ],
    )
    search_factory = Mock(return_value=search)
    monkeypatch.setattr(market_data.yf, "Search", search_factory)

    result = market_data.fetch_news("NVDA", count=10)

    search_factory.assert_called_once_with("NVDA stock", news_count=10)
    assert len(result) == 1
    assert result[0]["headline"] == "NVIDIA announces quarterly results"
    assert result[0]["source"] == "Financial News"
    assert result[0]["ticker"] == "NVDA"


def test_fetch_news_retries_plain_ticker_when_stock_search_is_empty(monkeypatch):
    monkeypatch.setattr(
        market_data.yf,
        "Ticker",
        Mock(return_value=Mock(get_news=Mock(return_value=[]))),
    )
    search_factory = Mock(side_effect=[Mock(news=[]), Mock(news=[])])
    monkeypatch.setattr(market_data.yf, "Search", search_factory)

    assert market_data.fetch_news("TCS", count=5) == []

    assert search_factory.call_args_list == [
        call("TCS.NS stock", news_count=5),
        call("TCS.NS", news_count=5),
    ]
