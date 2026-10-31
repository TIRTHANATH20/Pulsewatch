"""
Extractive summarization using a TextRank-style algorithm.

Sentences are embedded via TF-IDF, a sentence-similarity graph is built
from cosine similarity, and centrality (via networkx's PageRank) selects
the most representative sentences. This is a genuine, well-known
unsupervised summarization algorithm (Mihalcea & Tarau, 2004) run
locally — not an LLM call. An optional abstractive path (a local
seq2seq transformer, e.g. `sshleifer/distilbart-cnn-12-6`, or the
project's optional external LLM) is documented in NLP_ARCHITECTURE.md as
an enhancement layered on top; the extractive path here always works
without any additional dependency.
"""
from __future__ import annotations

import re

import networkx as nx
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from .preprocessing import preprocess_for_vectorizer

SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+|\n+")


def _split_sentences(text: str) -> list[str]:
    return [s.strip() for s in SENTENCE_SPLIT_RE.split(text) if s.strip()]


def summarize_text(text: str, max_sentences: int = 2) -> dict:
    sentences = _split_sentences(text)
    if len(sentences) <= max_sentences:
        return {"summary": text.strip(), "method": "passthrough (already short)", "sentencesUsed": sentences}

    cleaned = [preprocess_for_vectorizer(s) for s in sentences]
    try:
        vectorizer = TfidfVectorizer(min_df=1)
        matrix = vectorizer.fit_transform(cleaned)
    except ValueError:
        # TfidfVectorizer's default token pattern requires 2+ word
        # characters per token; degenerate input (e.g. all single-word
        # or single-character "sentences" that vanish after stopword
        # removal) can leave it with an empty vocabulary, which raises
        # rather than returning a zero matrix. Rather than 500 the
        # request, fall back to the first `max_sentences` sentences in
        # original reading order — a defensible, if less clever,
        # extractive summary, and one that always succeeds.
        selected = sentences[:max_sentences]
        return {
            "summary": " ".join(selected),
            "method": "first-N-sentences fallback (TF-IDF vocabulary was empty for this input)",
            "sentencesUsed": selected,
            "totalSentences": len(sentences),
        }

    sim_matrix = cosine_similarity(matrix)
    np.fill_diagonal(sim_matrix, 0)

    graph = nx.from_numpy_array(sim_matrix)
    scores = nx.pagerank(graph, max_iter=200)

    ranked = sorted(range(len(sentences)), key=lambda i: scores[i], reverse=True)[:max_sentences]
    ranked_in_order = sorted(ranked)  # preserve original reading order
    selected = [sentences[i] for i in ranked_in_order]

    return {
        "summary": " ".join(selected),
        "method": "TextRank (TF-IDF sentence graph + PageRank centrality)",
        "sentencesUsed": selected,
        "totalSentences": len(sentences),
    }


def summarize_articles(texts: list[str], max_sentences: int = 3) -> dict:
    """Aggregate summarization across multiple articles about the same
    company/day, per project spec section L."""
    articles = list(dict.fromkeys(text.strip() for text in texts if text.strip()))
    if not articles:
        return {
            "summary": "",
            "method": "no article text",
            "sentencesUsed": [],
            "totalSentences": 0,
        }

    result = summarize_text("\n".join(articles), max_sentences=max_sentences)
    result["summary"] = " · ".join(result["sentencesUsed"])
    result.setdefault("totalSentences", len(_split_sentences("\n".join(articles))))
    return result
