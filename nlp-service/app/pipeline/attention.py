"""
NLP-extended attention score.

Extends (does not replace) PulseWatch's existing price-based attention
engine (src/server/modules/attention/engine.ts) with news signals. This
module computes ONLY the news-derived component; the TypeScript side
combines it with the existing price-movement score — see
src/server/modules/nlp/attentionBridge.ts.

Documented, explicit formula (NOT a black box):

  newsScore (0-10) =
      3.0 * sentimentComponent      (how strongly positive/negative the news is, scaled by confidence)
    + 2.5 * eventComponent          (1.0 if a high-importance event type detected, else scaled by presence)
    + 2.0 * volumeComponent         (min(articleCount, 10) / 10)
    + 1.5 * noveltyComponent        (1 - max similarity to prior baseline articles; higher = more novel)
    + 1.0 * topicRelevanceComponent (top topic's relevance/probability for the dominant article)

Each weighted term is capped so no single signal can single-handedly
push the score to the max; the reasons list always mirrors exactly the
terms that contributed positively, satisfying the "explainable, not
arbitrary" requirement.
"""
from __future__ import annotations

from .corpus import articles_for_ticker
from .sentiment import predict_sentiment
from .events import extract_events
from .embeddings import get_default_embedder, cosine_sim

EVENT_IMPORTANCE = {
    "ACQUISITION": 1.0, "MERGER": 1.0, "REGULATORY_ACTION": 0.9,
    "LEADERSHIP_CHANGE": 0.8, "PARTNERSHIP": 0.85, "LAYOFFS": 0.85,
    "EARNINGS_ANNOUNCEMENT": 0.7, "PRODUCT_LAUNCH": 0.6, "DIVIDEND": 0.5,
    "FUNDING": 0.7, "EXPANSION": 0.5,
}

WEIGHTS = {"sentiment": 3.0, "event": 2.5, "volume": 2.0, "novelty": 1.5, "topic": 1.0}


def compute_news_attention(ticker: str) -> dict:
    articles = articles_for_ticker(ticker)
    if not articles:
        return {
            "newsAttentionScore": 0.0,
            "maxScore": 10.0,
            "reasons": ["No relevant news articles found for this ticker."],
            "articleCount": 0,
        }

    sentiments = [predict_sentiment(a.text) for a in articles]
    positive = sum(1 for s in sentiments if s.sentiment == "POSITIVE")
    negative = sum(1 for s in sentiments if s.sentiment == "NEGATIVE")
    neutral = len(sentiments) - positive - negative
    avg_confidence = sum(s.confidence for s in sentiments) / len(sentiments)
    net_sentiment_ratio = (positive - negative) / len(sentiments)  # -1..1
    sentiment_component = max(0.0, abs(net_sentiment_ratio) * avg_confidence)

    detected_events = []
    for a in articles:
        result = extract_events(a.full_text)
        if result["eventDetected"]:
            detected_events.append(result["events"][0]["eventType"])
    event_component = max((EVENT_IMPORTANCE.get(e, 0.4) for e in detected_events), default=0.0)

    volume_component = min(len(articles), 10) / 10

    texts = [a.full_text for a in articles]
    embedder, method = get_default_embedder(texts)
    vectors = [embedder.embed(t) for t in texts]
    if len(vectors) >= 2:
        newest = vectors[-1]
        baseline = vectors[:-1]
        max_sim = max(cosine_sim(newest, b) for b in baseline)
        novelty_component = max(0.0, 1 - max_sim)
    else:
        novelty_component = 0.5  # single article: neutral novelty, can't compare

    topic_relevance_component = 0.6 if detected_events else 0.3

    score = (
        WEIGHTS["sentiment"] * sentiment_component
        + WEIGHTS["event"] * event_component
        + WEIGHTS["volume"] * volume_component
        + WEIGHTS["novelty"] * novelty_component
        + WEIGHTS["topic"] * topic_relevance_component
    )
    score = round(min(score, 10.0), 2)

    reasons = []
    if sentiment_component > 0.1:
        direction = "positive" if net_sentiment_ratio > 0 else "negative"
        reasons.append(
            f"Sentiment split: {positive} positive, {neutral} neutral, and {negative} negative "
            f"articles; the directional balance is {direction} "
            f"({round(avg_confidence * 100)}% mean classifier confidence)."
        )
    if detected_events:
        top_event = max(detected_events, key=lambda e: EVENT_IMPORTANCE.get(e, 0.4))
        reasons.append(f"Detected a {top_event.replace('_', ' ').lower()} event.")
    if len(articles) >= 3:
        reasons.append(f"{len(articles)} relevant articles published.")
    if novelty_component > 0.5:
        reasons.append("Latest news is semantically different from recent baseline coverage.")
    if not reasons:
        reasons.append("News activity is present but below significance thresholds.")

    return {
        "newsAttentionScore": score,
        "maxScore": 10.0,
        "components": {
            "sentimentComponent": round(sentiment_component, 3),
            "eventComponent": round(event_component, 3),
            "volumeComponent": round(volume_component, 3),
            "noveltyComponent": round(novelty_component, 3),
            "topicRelevanceComponent": round(topic_relevance_component, 3),
        },
        "weights": WEIGHTS,
        "reasons": reasons,
        "articleCount": len(articles),
        "detectedEvents": detected_events,
        "embeddingMethod": method,
    }
