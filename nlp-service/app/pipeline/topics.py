"""
Topic modeling using Latent Dirichlet Allocation (gensim).

Topics are DISCOVERED from the corpus (unsupervised), not hardcoded. We
attach a human-readable label to each discovered topic by matching its
top words against a small keyword->label lookup (purely for display; the
underlying topic-word distributions are what LDA actually learned).

BERTopic (transformer-embedding + clustering based topic modeling) is
documented as the optional modern counterpart in NLP_ARCHITECTURE.md; it
requires sentence-transformers + UMAP + HDBSCAN which are too heavy for
this sandbox's disk budget, so it is not wired in here.
"""
from __future__ import annotations

from dataclasses import dataclass

from gensim import corpora, models

from .preprocessing import preprocess

LABEL_KEYWORDS = {
    "Earnings": {"earnings", "profit", "revenue", "quarter", "quarterly", "margin", "income"},
    "AI / Technology": {"ai", "artificial", "cloud", "technology", "generative", "azure", "data"},
    "M&A": {"acquisition", "merger", "acquired", "deal", "integration"},
    "Regulation": {"regulator", "regulatory", "compliance", "fine", "lawsuit", "scrutiny"},
    "Management": {"ceo", "cfo", "leadership", "appointed", "resigned", "board"},
    "Products": {"launch", "product", "line"},
    "Banking / Credit": {"loan", "deposit", "bank", "credit", "default"},
    "Macroeconomics": {"gdp", "inflation", "fed", "rbi", "macroeconomic", "rates"},
    "Energy": {"energy", "solar", "renewable", "oil"},
    "Hiring / Workforce": {"hiring", "layoffs", "workforce", "employees"},
}


def _label_for_topic(words: list[str]) -> str:
    wordset = set(w.lower() for w in words)
    best_label, best_overlap = "General", 0
    for label, keywords in LABEL_KEYWORDS.items():
        overlap = len(wordset & keywords)
        if overlap > best_overlap:
            best_overlap = overlap
            best_label = label
    return best_label


def aggregate_document_topics(
    doc_topics: list[list[dict]], top_n: int = 5
) -> list[dict]:
    """Return corpus-level topic labels instead of repeating each article's top topic."""
    if not doc_topics:
        return []

    totals: dict[str, float] = {}
    topic_totals: dict[str, dict[int, float]] = {}
    for distribution in doc_topics:
        for item in distribution:
            label = str(item["label"])
            topic_id = int(item["topicId"])
            relevance = float(item["relevance"])
            totals[label] = totals.get(label, 0.0) + relevance
            by_id = topic_totals.setdefault(label, {})
            by_id[topic_id] = by_id.get(topic_id, 0.0) + relevance

    ranked = sorted(totals, key=lambda label: totals[label], reverse=True)[:top_n]
    return [
        {
            "topicId": max(topic_totals[label], key=topic_totals[label].get),
            "label": label,
            "relevance": round(totals[label] / len(doc_topics), 4),
        }
        for label in ranked
    ]


@dataclass
class TopicModelResult:
    num_topics: int
    topics: list[dict]
    doc_topics: list[list[dict]]  # per-document topic distribution


def run_lda(texts: list[str], num_topics: int = 5, passes: int = 20, seed: int = 42) -> TopicModelResult:
    tokenized = [preprocess(t).tokens_no_stop for t in texts]
    dictionary = corpora.Dictionary(tokenized)
    dictionary.filter_extremes(no_below=1, no_above=0.9)
    corpus = [dictionary.doc2bow(doc) for doc in tokenized]

    num_topics = max(1, min(num_topics, len(texts)))
    lda = models.LdaModel(
        corpus=corpus, id2word=dictionary, num_topics=num_topics,
        passes=passes, random_state=seed, alpha="auto", eta="auto",
    )

    topics_out = []
    for topic_id in range(num_topics):
        top_terms = lda.show_topic(topic_id, topn=8)
        words = [w for w, _ in top_terms]
        article_count = 0
        for bow in corpus:
            dist = dict(lda.get_document_topics(bow))
            if dist.get(topic_id, 0) == max(dist.values(), default=0):
                article_count += 1
        topics_out.append({
            "topicId": topic_id,
            "label": _label_for_topic(words),
            "topWords": [{"term": w, "weight": round(float(wt), 4)} for w, wt in top_terms],
            "articleCount": article_count,
        })

    doc_topics = []
    for bow in corpus:
        dist = lda.get_document_topics(bow)
        dist_sorted = sorted(dist, key=lambda x: -x[1])
        doc_topics.append([
            {"topicId": tid, "label": topics_out[tid]["label"], "relevance": round(float(w), 4)}
            for tid, w in dist_sorted
        ])

    return TopicModelResult(num_topics=num_topics, topics=topics_out, doc_topics=doc_topics)
