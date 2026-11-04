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


def test_previous_question_memory_accepts_short_follow_up():
    from app.agents import graph

    result = graph.run_graph(
        "my previous question?",
        [{"role": "user", "content": "What is RELIANCE trading at?"}],
    )

    assert "RELIANCE" in result["answer"]
    assert "previous question" in result["answer"].lower()


def test_quote_question_is_detected():
    from app.agents import graph

    assert graph._is_quote_question("What is RELIANCE trading at?") is True
    assert graph._is_quote_question("Why is RELIANCE moving?") is False


def test_horizon_follow_up_is_preserved_as_a_conversation_context():
    from app.agents import graph

    assert graph._is_horizon_followup("for short term") is True
    assert graph._is_horizon_followup("for long term") is True
    assert graph._requested_horizon("for long term") == "long_term"


def test_common_chat_intents_are_detected():
    from app.agents import graph

    assert graph._is_portfolio_recommendation("What should I buy?") is True
    assert graph._is_greeting("hello") is True
    assert graph._is_greeting("What is AAPL doing?") is False


def test_greeting_does_not_trigger_market_lookup():
    from app.agents import graph

    result = graph.run_graph("hello")

    assert result["tickers"] == []
    assert "stock prices" in result["answer"]


def test_pronoun_follow_up_can_reuse_previous_ticker():
    from app.agents import graph

    assert graph._has_unresolved_company_reference("what about its latest news?") is False


def test_purchase_question_is_detected():
    from app.agents import graph

    assert graph._is_purchase_question("Should I buy more of this stock?") is True
    assert graph._is_purchase_question("What is the current price?") is False


def test_graph_accepts_owned_symbols():
    from app.agents import graph
    import inspect

    assert "owned_symbols" in inspect.signature(graph.run_graph).parameters


def test_purchase_guidance_is_conversational():
    from app.agents import graph

    assert graph._is_purchase_question("Should I buy it?") is True


def test_purchase_followup_keeps_the_previous_stock(monkeypatch):
    from app.agents import graph

    captured = {}

    def fake_invoke(state):
        captured.update(state)
        return {
            "answer": "Should I buy it?",
            "agents": [],
            "evidence": {},
            "market": [],
            "verification": {"status": "passed", "issues": []},
        }

    monkeypatch.setattr(graph.chat_graph, "invoke", fake_invoke)

    result = graph.run_graph(
        "should I invest in itc",
        [{"role": "assistant", "tickers": ["ITC.NS"]}],
    )

    assert captured["tickers"] == ["ITC.NS"]
    assert result["tickers"] == ["ITC.NS"]


def test_common_word_is_not_detected_as_ticker():
    from app.agents import graph

    assert graph.resolve_tickers("should I buy or not", ["RELIANCE"]) == []


def test_recommendation_sentence_uses_clear_action_language():
    from app.agents import graph

    assert "suggest buying" in graph._recommendation_sentence(
        "RELIANCE", "consider", "the trend is up", False, "Should I buy this?"
    )
    assert "suggest selling" in graph._recommendation_sentence(
        "RELIANCE", "avoid", "the trend is down", True, "Should I sell this?"
    )


def test_owned_stock_purchase_guidance_does_not_contradict_itself():
    from app.agents import graph

    answer = graph._recommendation_sentence(
        "RELIANCE", "consider", "the trend is up", True, "Should I buy more?"
    )
    assert "adding to your position" in answer
    assert "do not currently own" not in answer


def test_portfolio_recommendation_is_detected():
    from app.agents import graph

    assert graph._is_portfolio_recommendation("What companies should I invest into?") is True
    assert graph._is_portfolio_recommendation("Suggest me some new stocks to buy") is True
    assert graph._is_portfolio_recommendation("What is NVIDIA trading at?") is False
    assert len(graph._RECOMMENDATION_UNIVERSE[:3]) == 3


def test_broad_recommendations_are_not_holdings_comparisons():
    from app.agents import graph

    assert graph._is_holdings_comparison("What should I do with my portfolio?") is True
    assert graph._is_holdings_comparison("Suggest me some stocks to buy") is False
    assert graph._is_holdings_comparison("What companies should I invest into?") is False


def test_chat_forecast_uses_multiple_horizons():
    from app.agents import graph

    direction, confidence, score = graph._forecast_signals(
        [100 + index * 0.8 for index in range(70)]
    )
    assert direction == "up"
    assert confidence == "moderate"
    assert score > 1


def test_chat_answer_removes_markdown_formatting():
    from app.agents import graph

    answer = graph._clean_chat_answer(
        "**Hold**\n\n- The trend is positive.\n\n## Why"
    )
    assert answer == "Hold\n\nThe trend is positive.\n\nWhy"
    assert "**" not in answer


def test_signal_agreement_explains_conflicting_news():
    from app.agents import graph

    assert "conflicts" in graph._signal_agreement(
        "up", ["Company faces lawsuit and weak demand"]
    )
    assert "supports" in graph._signal_agreement(
        "up", ["Company reports record growth and strong demand"]
    )
