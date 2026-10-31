import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

from app import main
from app.pipeline import (
    preprocessing, sentiment, ner, classification, aspect_sentiment,
    events, summarization, tfidf, topics, embeddings, clustering, attention,
    corpus, rag,
)

@pytest.fixture(autouse=True)
def configured_sample_corpus(monkeypatch):
    sample_path = Path(__file__).resolve().parents[1] / "data" / "sample_news.csv"
    monkeypatch.setenv("NEWS_CORPUS_PATH", str(sample_path))
    monkeypatch.setenv(
        "SENTIMENT_DATASET_PATH",
        str(Path(__file__).resolve().parents[1] / "data" / "sample_phrasebank.csv"),
    )
    monkeypatch.setenv(
        "CLASSIFICATION_DATASET_PATH",
        str(Path(__file__).resolve().parents[1] / "data" / "sample_news_categories.csv"),
    )


SAMPLE_TEXT = "TCS signed a $2 billion AI partnership with Microsoft to accelerate generative AI adoption, up 4.2%."


def test_preprocessing_preserves_financial_tokens():
    result = preprocessing.preprocess(SAMPLE_TEXT)
    assert "$2 billion" in result.money_mentions
    assert "4.2%" in result.percent_mentions
    assert "ai" in result.tokens_no_stop
    assert "up" in result.tokens_no_stop  # must not be stripped as a stopword


def test_preprocessing_handles_empty_and_plain_text():
    result = preprocessing.preprocess("Hello world.")
    assert result.tokens == ["Hello", "world"]


def test_sentiment_output_structure():
    result = sentiment.predict_sentiment("The company reported record profit and raised guidance.")
    assert result.sentiment in {"POSITIVE", "NEGATIVE", "NEUTRAL"}
    assert 0.0 <= result.confidence <= 1.0
    assert abs(sum(result.probabilities.values()) - 1.0) < 1e-6
    assert set(result.probabilities.keys()) == {"positive", "neutral", "negative"}


def test_sentiment_evaluate_returns_real_metrics_not_hardcoded():
    metrics = sentiment.get_classical_model().evaluate()
    assert metrics["testSize"] > 0
    assert 0.0 <= metrics["accuracy"] <= 1.0
    assert "confusionMatrix" in metrics


def test_runtime_classifiers_do_not_use_bundled_samples_without_explicit_paths(monkeypatch):
    monkeypatch.delenv("SENTIMENT_DATASET_PATH")
    monkeypatch.delenv("CLASSIFICATION_DATASET_PATH")
    monkeypatch.setattr(sentiment, "_classical_singleton", None)
    monkeypatch.setattr(sentiment, "_transformer_unavailable", True)
    monkeypatch.setattr(classification, "_singleton", None)

    sentiment_result = sentiment.predict_sentiment("Company reports record profit growth.")
    category_result = classification.classify_text("Company reports quarterly earnings.")

    assert sentiment_result.modelUsed == "rule-based-lexicon"
    assert sentiment_result.sentiment == "POSITIVE"
    assert category_result["method"] == "rule-based-keywords"
    assert category_result["category"] == "EARNINGS"


def test_ner_extracts_known_entities():
    result = ner.extract_entities(SAMPLE_TEXT)
    labels = {e["label"] for e in result["entities"]}
    texts = {e["text"] for e in result["entities"]}
    assert "MONEY" in labels
    assert "PERCENT" in labels
    assert "TCS" in texts
    assert "Microsoft" in texts


def test_classification_returns_valid_category():
    result = classification.classify_text(SAMPLE_TEXT)
    assert result["category"] in classification.CATEGORIES
    assert 0.0 <= result["confidence"] <= 1.0


def test_aspect_sentiment_splits_contrastive_clauses():
    result = aspect_sentiment.analyze_aspects(
        "TCS reported excellent earnings but weak hiring guidance."
    )
    aspects_found = {a["aspect"] for a in result["aspectSentiments"]}
    assert "earnings" in aspects_found
    assert "hiring" in aspects_found


def test_event_extraction_detects_partnership():
    result = events.extract_events(SAMPLE_TEXT)
    assert result["eventDetected"] is True
    assert result["events"][0]["eventType"] == "PARTNERSHIP"
    assert result["events"][0]["actor"] is not None


def test_event_extraction_target_is_not_same_company_as_actor():
    """A company can be mentioned twice under different surface forms
    (e.g. 'TCS' and 'Tata Consultancy Services', both normalizing to the
    same canonical name). Actor/target assignment must deduplicate by
    normalized identity, not raw entity order, or the second mention of
    the SAME company gets mistaken for the counterparty and the real
    target (e.g. Microsoft) is never picked up even though NER found it."""
    text = (
        "Tata Consultancy Services (TCS) announced a $2 billion strategic "
        "partnership with Microsoft to accelerate generative AI adoption."
    )
    result = events.extract_events(text)
    assert result["eventDetected"] is True
    actor = result["events"][0]["actor"]
    target = result["events"][0]["target"]
    assert actor is not None and target is not None
    assert actor.lower() != target.lower()
    assert target == "Microsoft"


def test_event_extraction_no_trigger_returns_not_detected():
    result = events.extract_events("The weather today is sunny with a light breeze.")
    assert result["eventDetected"] is False


def test_earnings_growth_headline_is_not_misclassified_as_announcement():
    result = events.extract_events(
        "Nvidia stock price lags massive earnings growth."
    )
    assert result["eventDetected"] is False


def test_earnings_results_are_detected_as_an_announcement():
    result = events.extract_events(
        "NVIDIA announced its quarterly earnings results."
    )
    assert result["eventDetected"] is True
    assert result["events"][0]["eventType"] == "EARNINGS_ANNOUNCEMENT"


def test_summarization_shorter_than_original_for_long_text():
    long_text = (
        "TCS reported strong quarterly earnings, beating analyst expectations. "
        "The company also announced a major AI partnership with Microsoft. "
        "Hiring guidance for the next quarter remains cautious. "
        "Analysts reacted positively to the overall results. "
        "Shares rose sharply following the announcement."
    )
    result = summarization.summarize_text(long_text, max_sentences=2)
    assert len(result["summary"]) < len(long_text)
    assert result["totalSentences"] == 5


def test_headline_only_stock_summary_discloses_no_article_text(monkeypatch):
    articles = [
        corpus.Article("1", "NVDA shares rise after results", "NVDA shares rise after results", "", "Yahoo", "NVDA"),
        corpus.Article("2", "Analysts raise NVDA target", "Analysts raise NVDA target", "", "Yahoo", "NVDA"),
    ]
    monkeypatch.setattr(main, "_ticker_articles", lambda _ticker: articles)

    result = main.stock_summary("NVDA")

    assert "headlines without article summaries" in result["summary"]
    assert " · " in result["summary"]
    assert result["method"] == "Yahoo Finance headline-only news"


def test_article_summaries_keep_headlines_separate_and_remove_duplicates():
    result = summarization.summarize_articles(
        [
            "NVDA shares rise after strong quarterly results",
            "Analysts raise their price target for NVDA",
            "NVDA shares rise after strong quarterly results",
        ],
        max_sentences=3,
    )
    assert result["totalSentences"] == 2
    assert " · " in result["summary"]
    assert result["summary"].count("NVDA shares rise") == 1


def test_tfidf_keyphrase_extraction_returns_ranked_terms():
    keyphrases = tfidf.extract_keyphrases(SAMPLE_TEXT, corpus_texts=[a.full_text for a in corpus.load_corpus()])
    assert len(keyphrases) > 0
    scores = [k["score"] for k in keyphrases]
    assert scores == sorted(scores, reverse=True)


def test_topic_modeling_discovers_topics_from_corpus():
    articles = corpus.load_corpus()
    result = topics.run_lda([a.full_text for a in articles], num_topics=3)
    assert result.num_topics == 3
    assert len(result.topics) == 3
    for t in result.topics:
        assert len(t["topWords"]) > 0


def test_aggregated_topics_are_unique_labels_weighted_across_articles():
    result = topics.aggregate_document_topics(
        [
            [
                {"topicId": 1, "label": "AI / Technology", "relevance": 0.8},
                {"topicId": 2, "label": "Earnings", "relevance": 0.2},
            ],
            [
                {"topicId": 3, "label": "AI / Technology", "relevance": 0.7},
                {"topicId": 2, "label": "Earnings", "relevance": 0.3},
            ],
        ],
    )
    assert [topic["label"] for topic in result] == ["AI / Technology", "Earnings"]
    assert result[0]["relevance"] == 0.75
    assert result[1]["relevance"] == 0.25


def test_word2vec_trains_and_embeds():
    articles = corpus.load_corpus()
    embedder = embeddings.Word2VecEmbedder([a.full_text for a in articles])
    vec = embedder.embed("TCS AI partnership")
    assert vec.shape[0] == embedder.vector_size


def test_clustering_groups_all_documents():
    articles = corpus.load_corpus()
    result = clustering.cluster_articles([a.id for a in articles], [a.full_text for a in articles])
    all_ids = {aid for cluster in result["clusters"] for aid in cluster["docIds"]}
    assert all_ids == {a.id for a in articles}


def test_attention_score_is_explainable_and_bounded():
    result = attention.compute_news_attention("TCS")
    assert 0.0 <= result["newsAttentionScore"] <= result["maxScore"]
    assert len(result["reasons"]) > 0
    assert "components" in result


def test_attention_reason_reports_sentiment_distribution(monkeypatch):
    articles = [
        corpus.Article("1", "Positive headline", "Positive headline", "", "Yahoo", "NVDA"),
        corpus.Article("2", "Neutral headline", "Neutral headline", "", "Yahoo", "NVDA"),
    ]
    predictions = iter([
        SimpleNamespace(sentiment="POSITIVE", confidence=0.6),
        SimpleNamespace(sentiment="NEUTRAL", confidence=0.5),
    ])

    class FixedEmbedder:
        def embed(self, _text):
            return [1.0, 0.0]

    monkeypatch.setattr(attention, "articles_for_ticker", lambda _ticker: articles)
    monkeypatch.setattr(attention, "predict_sentiment", lambda _text: next(predictions))
    monkeypatch.setattr(attention, "extract_events", lambda _text: {"eventDetected": False})
    monkeypatch.setattr(attention, "get_default_embedder", lambda _texts: (FixedEmbedder(), "test"))
    monkeypatch.setattr(attention, "cosine_sim", lambda _left, _right: 0.5)

    result = attention.compute_news_attention("NVDA")

    assert result["reasons"][0] == (
        "Sentiment split: 1 positive, 1 neutral, and 0 negative articles; "
        "the directional balance is positive (55% mean classifier confidence)."
    )


def test_attention_score_handles_unknown_ticker_gracefully():
    result = attention.compute_news_attention("NOSUCHTICKER")
    assert result["newsAttentionScore"] == 0.0
    assert result["articleCount"] == 0


def test_rag_retrieves_relevant_ticker_specific_articles():
    result = rag.answer_query("Why is TCS moving today?", ticker="TCS")
    assert len(result["sources"]) > 0
    assert all(s["ticker"] == "TCS" for s in result["sources"])
    assert all(s["text"] for s in result["sources"])
    assert result["confidence"] > 0
    assert "bundled sample corpus" in result["answer"]


def test_rag_discloses_unverified_custom_corpus(monkeypatch, tmp_path):
    custom_path = tmp_path / "custom.csv"
    custom_path.write_text(
        "id,headline,text,date,source,ticker\n"
        "c1,NVIDIA earnings update,NVIDIA reported quarterly earnings growth,2026-10-01,ExampleSource,NVDA\n"
    )
    monkeypatch.setenv("NEWS_CORPUS_PATH", str(custom_path))
    monkeypatch.setattr(rag, "MIN_RELEVANT_SIMILARITY", -1)

    result = rag.answer_query(
        "What happened to NVIDIA earnings?",
        ticker="NVDA",
        generate=False,
    )

    assert result["sources"]
    assert "source provenance is unverified" in result["answer"]


def test_rag_returns_insufficient_evidence_for_irrelevant_query():
    result = rag.answer_query("What is the capital of France?", ticker="TCS")
    assert "insufficient evidence" in result["answer"].lower()
    assert result["sources"] == []


# --- Robustness / edge-case tests --------------------------------------

def test_summarize_text_does_not_crash_on_degenerate_input():
    """TfidfVectorizer's default tokenizer drops single-character tokens,
    so short/degenerate multi-sentence input can leave it with an empty
    vocabulary. summarize_text() must degrade gracefully (first-N-sentence
    fallback) rather than raise. See summarization.py's try/except."""
    result = summarization.summarize_text("A. B. C. D. E.", max_sentences=2)
    assert "summary" in result
    assert result["summary"]  # non-empty
    assert "fallback" in result["method"] or "passthrough" in result["method"]


def test_extract_keyphrases_does_not_crash_on_degenerate_input():
    """extract_keyphrases must return an empty list, not raise, on text
    that reduces to an empty TF-IDF vocabulary (single letters, pure
    numbers/punctuation, etc.) — a realistic input from the /nlp-demo
    paste-your-own-text page."""
    for text in ["a", "123", "!!!", "a a a a"]:
        result = tfidf.extract_keyphrases(text)
        assert result == []


def test_nlp_topics_empty_corpus_still_matches_schema_shape():
    """corpus.load_corpus() must return an empty list (not raise) when the
    configured corpus path doesn't exist, so downstream endpoints can
    render an explicit empty state instead of erroring. The full
    response-shape contract for GET /nlp/topics (numTopics must be
    present even when topics is empty, since the Next.js Zod schema
    requires it) is exercised end-to-end by
    test_api.py::test_topics_empty_corpus."""
    empty = corpus.load_corpus(Path("/tmp/pulsewatch-does-not-exist.csv"))
    assert empty == []
    # main.py's api_topics() branch (not re-imported here to avoid a
    # FastAPI app spin-up) must return numTopics alongside topics/note;
    # this is exercised end-to-end by test_api.py::test_topics_empty_corpus.


def test_related_news_empty_corpus_returns_404_not_malformed_200():
    """An empty corpus must not produce a response missing required fields
    ('articleId') that the Next.js Zod schema expects — see
    test_api.py::test_related_news_empty_corpus for the end-to-end check
    that this now returns a clean 404 instead."""
    empty = corpus.load_corpus(Path("/tmp/pulsewatch-does-not-exist.csv"))
    assert empty == []


def test_attention_score_handles_single_article_ticker_without_warning():
    """A low-volume ticker with exactly one article is a normal occurrence,
    not a rare edge case. TruncatedSVD's internal variance computation
    divides by zero for a single sample; that must stay a silenced,
    documented no-op (see embeddings.py) rather than a RuntimeWarning
    surfacing on every such request. Verified here by promoting warnings
    to errors for the duration of the call."""
    import csv
    import tempfile
    import warnings as warnings_module

    with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False, newline="") as f:
        w = csv.writer(f)
        w.writerow(["id", "headline", "text", "date", "source", "ticker"])
        w.writerow(["x1", "Solo article", "A single article about XYZ Corp earnings growth.", "2026-01-01", "Test", "XYZ"])
        path = f.name

    import os
    os.environ["NEWS_CORPUS_PATH"] = path
    try:
        with warnings_module.catch_warnings():
            warnings_module.simplefilter("error", category=RuntimeWarning)
            result = attention.compute_news_attention("XYZ")
        assert result["articleCount"] == 1
        assert 0.0 <= result["newsAttentionScore"] <= 10.0
    finally:
        del os.environ["NEWS_CORPUS_PATH"]


def test_rag_index_handles_empty_corpus_without_crashing():
    """A zero-article corpus (missing/empty NEWS_CORPUS_PATH) must not
    crash FAISS index construction. scikit-learn's TfidfVectorizer raises
    on an empty document list, so NewsVectorIndex must special-case it
    rather than pass an empty list straight to the embedder."""
    index = rag.NewsVectorIndex([])
    assert index.search("any query") == []
    assert index.dim == 0


def test_rag_answer_query_handles_empty_corpus_without_crashing():
    """End-to-end: answer_query() must return the standard 'insufficient
    evidence' shape (not raise) when the configured corpus is empty."""
    import os

    empty_csv = "/tmp/pulsewatch-empty-corpus-test.csv"
    with open(empty_csv, "w") as f:
        f.write("id,headline,text,date,source,ticker\n")
    os.environ["NEWS_CORPUS_PATH"] = empty_csv
    try:
        rag.get_index(refresh=True)
        result = rag.answer_query("Why is TCS moving today?", ticker="TCS")
        assert result["sources"] == []
        assert "insufficient evidence" in result["answer"].lower()
    finally:
        del os.environ["NEWS_CORPUS_PATH"]
        rag.get_index(refresh=True)  # restore the default corpus for later tests


def test_corpus_load_skips_malformed_rows_without_crashing(tmp_path):
    """A row missing a required field (id/headline/text) must be skipped
    with a warning, not crash the entire corpus load — one bad row
    shouldn't take down every corpus-dependent endpoint."""
    csv_path = tmp_path / "malformed.csv"
    csv_path.write_text(
        "id,headline,text,date,source,ticker\n"
        "x1,,Some text,2026-01-01,Test,TCS\n"  # blank headline -> skipped
        "x2,Real headline,Real text,2026-01-01,Test,TCS\n"  # valid -> kept
    )
    articles = corpus.load_corpus(csv_path)
    assert len(articles) == 1
    assert articles[0].id == "x2"


def test_corpus_load_handles_missing_column_without_crashing(tmp_path):
    """A CSV missing a required column entirely (not just a blank value)
    must degrade to an empty corpus, not raise a KeyError."""
    csv_path = tmp_path / "missing_column.csv"
    csv_path.write_text("id,headline,date,source,ticker\nx1,Test,2026-01-01,Test,TCS\n")
    assert corpus.load_corpus(csv_path) == []


def test_corpus_load_handles_corrupt_json_without_crashing(tmp_path):
    """An unparseable JSON corpus file must degrade to an empty corpus,
    not raise JSONDecodeError up through every caller."""
    json_path = tmp_path / "corrupt.json"
    json_path.write_text("{not valid json")
    assert corpus.load_corpus(json_path) == []


def test_corpus_load_handles_json_that_is_not_a_list(tmp_path):
    """A JSON corpus file whose top level is an object, not a list, must
    degrade to an empty corpus rather than raising while iterating."""
    json_path = tmp_path / "not_a_list.json"
    json_path.write_text('{"oops": "not a list"}')
    assert corpus.load_corpus(json_path) == []


def test_corpus_load_normal_file_still_works():
    """Sanity check that the malformed-row handling above didn't regress
    the happy path: the bundled sample corpus still loads all 15 articles."""
    sample_path = Path(__file__).resolve().parents[1] / "data" / "sample_news.csv"
    assert len(corpus.load_corpus(sample_path)) == 15


def test_rag_generate_false_never_calls_the_llm(monkeypatch):
    """The chatbot asks for retrieval only; a configured API key must not
    trigger a (slow, billable) LLM call whose answer would be discarded."""
    monkeypatch.setenv("GROQ_API_KEY", "gsk-test-not-real")

    def boom(*args, **kwargs):
        raise AssertionError("LLM must not be called when generate=False")

    monkeypatch.setattr(rag, "_call_groq", boom)
    result = rag.answer_query("Why is TCS moving today?", ticker="TCS", generate=False)
    assert result["sources"], "retrieval must still return evidence"
    assert "skipped by caller" in result["generation"]


def test_rag_groq_uses_configured_key_and_model(monkeypatch):
    import requests

    monkeypatch.setenv("GROQ_API_KEY", "gsk-test-not-real")
    monkeypatch.setenv("GROQ_RAG_MODEL", "test-model")
    captured = {}

    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return {"choices": [{"message": {"content": "Grounded answer"}}]}

    def fake_post(url, **kwargs):
        captured.update(url=url, **kwargs)
        return Response()

    monkeypatch.setattr(requests, "post", fake_post)

    assert rag._call_groq("question", "article context") == "Grounded answer"
    assert captured["url"] == "https://api.groq.com/openai/v1/chat/completions"
    assert captured["headers"]["Authorization"] == "Bearer gsk-test-not-real"
    assert captured["json"]["model"] == "test-model"


def test_corpus_info_reports_live_vs_custom(monkeypatch, tmp_path):
    monkeypatch.delenv("NEWS_CORPUS_PATH", raising=False)
    info = corpus.corpus_info()
    assert info == {"kind": "live", "articleCount": 0}

    custom = tmp_path / "custom.csv"
    custom.write_text("id,headline,text,date,source,ticker\nx1,Head,Body text here,2026-01-01,Src,TCS\n")
    monkeypatch.setenv("NEWS_CORPUS_PATH", str(custom))
    info = corpus.corpus_info()
    assert info == {"kind": "custom", "articleCount": 1}


def test_corpus_info_labels_bundled_news_as_sample(monkeypatch):
    sample_path = Path(__file__).resolve().parents[1] / "data" / "sample_news.csv"
    monkeypatch.setenv("NEWS_CORPUS_PATH", str(sample_path))

    assert corpus.corpus_info() == {"kind": "sample", "articleCount": 15}
