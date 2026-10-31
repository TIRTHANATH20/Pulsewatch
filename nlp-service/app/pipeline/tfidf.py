"""TF-IDF vectorization, explainable keyword extraction, and cosine similarity."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from .preprocessing import preprocess_for_vectorizer


@dataclass
class TfidfIndex:
    vectorizer: TfidfVectorizer
    matrix: np.ndarray
    doc_ids: list[str]
    raw_texts: list[str]

    def top_keywords(self, doc_index: int, k: int = 8) -> list[dict]:
        row = self.matrix[doc_index].toarray().ravel()
        terms = self.vectorizer.get_feature_names_out()
        order = np.argsort(row)[::-1][:k]
        return [
            {"term": terms[i], "score": round(float(row[i]), 4)}
            for i in order if row[i] > 0
        ]

    def most_similar(self, doc_index: int, top_k: int = 3) -> list[dict]:
        sims = cosine_similarity(self.matrix[doc_index], self.matrix).ravel()
        order = np.argsort(sims)[::-1]
        results = []
        for i in order:
            if i == doc_index:
                continue
            results.append({
                "docId": self.doc_ids[i],
                "similarity": round(float(sims[i]), 4),
            })
            if len(results) >= top_k:
                break
        return results

    def similar_to_text(self, text: str, top_k: int = 3) -> list[dict]:
        cleaned = preprocess_for_vectorizer(text)
        vec = self.vectorizer.transform([cleaned])
        sims = cosine_similarity(vec, self.matrix).ravel()
        order = np.argsort(sims)[::-1][:top_k]
        return [
            {"docId": self.doc_ids[i], "similarity": round(float(sims[i]), 4)}
            for i in order
        ]


def build_tfidf_index(doc_ids: list[str], texts: list[str], max_features: int = 4000) -> TfidfIndex:
    cleaned = [preprocess_for_vectorizer(t) for t in texts]
    vectorizer = TfidfVectorizer(
        max_features=max_features,
        ngram_range=(1, 2),  # unigrams + bigrams -> supports keyphrase extraction
        min_df=1,
    )
    matrix = vectorizer.fit_transform(cleaned)
    return TfidfIndex(vectorizer=vectorizer, matrix=matrix, doc_ids=doc_ids, raw_texts=texts)


def extract_keyphrases(text: str, corpus_texts: list[str] | None = None, top_k: int = 6) -> list[dict]:
    """Extract keyphrases for a single piece of text.

    If a background corpus is supplied, IDF is computed from it (more
    meaningful weighting). Otherwise falls back to a single-document
    TF-only ranking.
    """
    background = corpus_texts if corpus_texts else [text]
    cleaned_bg = [preprocess_for_vectorizer(t) for t in background]
    cleaned_target = preprocess_for_vectorizer(text)
    if cleaned_target not in cleaned_bg:
        cleaned_bg = cleaned_bg + [cleaned_target]
        target_index = len(cleaned_bg) - 1
    else:
        target_index = cleaned_bg.index(cleaned_target)

    vectorizer = TfidfVectorizer(ngram_range=(1, 3), min_df=1, max_features=3000)
    try:
        matrix = vectorizer.fit_transform(cleaned_bg)
    except ValueError:
        # Degenerate input (empty after stopword removal, all-numeric,
        # all-punctuation, etc.) leaves scikit-learn's default tokenizer
        # with nothing to build a vocabulary from. That's a legitimate
        # "no keyphrases here" outcome, not a server error.
        return []
    row = matrix[target_index].toarray().ravel()
    terms = vectorizer.get_feature_names_out()
    order = np.argsort(row)[::-1]
    out = []
    for i in order:
        if row[i] <= 0:
            continue
        term = terms[i]
        if len(term.split()) == 1 and len(term) <= 2:
            continue
        out.append({"phrase": term, "score": round(float(row[i]), 4)})
        if len(out) >= top_k:
            break
    return out
