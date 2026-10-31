import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def test_resolve_tickers_uses_company_directory_for_unknown_names(monkeypatch):
    from app.agents import graph

    def fake_search(query, max_results):
        assert query == "tata motors"
        return SimpleNamespace(
            quotes=[
                {
                    "quoteType": "EQUITY",
                    "symbol": "TATAMOTORS.NS",
                    "longname": "Tata Motors Limited",
                }
            ]
        )

    monkeypatch.setattr(graph.yf, "Search", fake_search)
    graph._search_company_symbol.cache_clear()

    assert graph.resolve_tickers("How is Tata Motors doing?", []) == ["TATAMOTORS.NS"]


def test_plain_company_name_does_not_require_a_ticker_or_alias(monkeypatch):
    from app.agents import graph

    def fake_search(query, max_results):
        assert query == "boeing"
        return SimpleNamespace(
            quotes=[
                {
                    "quoteType": "EQUITY",
                    "symbol": "BA",
                    "longname": "The Boeing Company",
                }
            ]
        )

    monkeypatch.setattr(graph.yf, "Search", fake_search)
    graph._search_company_symbol.cache_clear()

    assert "boeing" not in graph.ALIASES
    assert graph.resolve_tickers("Boeing", []) == ["BA"]


def test_resolve_tickers_does_not_turn_generic_questions_into_symbols(monkeypatch):
    from app.agents import graph

    monkeypatch.setattr(
        graph.yf,
        "Search",
        lambda query, max_results: SimpleNamespace(quotes=[]),
    )
    graph._search_company_symbol.cache_clear()

    assert graph.resolve_tickers("What is the market doing?", []) == []


def test_current_message_ticker_takes_priority_over_known_symbols():
    from app.agents import graph

    assert graph.resolve_tickers("tcs?", ["NVDA", "AAPL", "MSFT"]) == ["TCS"]


def test_lowercase_ticker_can_use_company_directory(monkeypatch):
    from app.agents import graph

    def fake_search(query, max_results):
        assert query == "jpm"
        return SimpleNamespace(
            quotes=[
                {
                    "quoteType": "EQUITY",
                    "symbol": "JPM",
                    "longname": "JPMorgan Chase & Co.",
                }
            ]
        )

    monkeypatch.setattr(graph.yf, "Search", fake_search)
    graph._search_company_symbol.cache_clear()

    assert graph.resolve_tickers("jpm", []) == ["JPM"]


def test_unrecognized_company_does_not_reuse_previous_ticker():
    from app.agents import graph

    result = graph.run_graph(
        "what about tis?",
        [{"role": "assistant", "tickers": ["INFY"]}],
    )

    assert result["tickers"] == []
    assert "couldn't identify" in result["answer"].lower()


def test_generic_follow_up_can_reuse_previous_ticker():
    from app.agents import graph

    assert graph._has_unresolved_company_reference("what is the price?") is False
