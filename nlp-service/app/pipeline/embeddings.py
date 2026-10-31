"""
Text representation: traditional vs modern embeddings.

- `Word2VecEmbedder`: trains a real gensim Word2Vec model on whatever
  corpus is passed in (Yahoo Finance ticker news or an explicitly configured corpus). Document
  vectors are the mean of constituent word vectors. This demonstrates
  the "traditional vector representation" branch of the project.
- `TfidfSvdEmbedder`: TF-IDF followed by truncated SVD (i.e. classic
  Latent Semantic Analysis) — a second, still-classical, dense
  representation used as the default for semantic similarity/RAG in this
  sandbox, since it needs no model download.
- `TransformerEmbedder` (optional): sentence-transformers
  (`all-MiniLM-L6-v2` by default). Not installed in this sandbox for disk
  reasons (~90MB dependency chain incl. torch) — documented in
  NLP_SETUP.md. When available, this is what a production deployment
  should use for RAG.

`get_default_embedder()` picks the transformer embedder if available,
else falls back to TF-IDF+SVD, and reports which one is active — same
graceful-fallback pattern as sentiment.py.
"""
from __future__ import annotations

import warnings
import numpy as np
from gensim.models import Word2Vec
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import TfidfVectorizer

from .preprocessing import preprocess


class Word2VecEmbedder:
    method = "word2vec"

    def __init__(self, texts: list[str], vector_size: int = 64, window: int = 5, min_count: int = 1, seed: int = 42):
        tokenized = [preprocess(t).tokens_no_stop for t in texts]
        self.model = Word2Vec(
            sentences=tokenized, vector_size=vector_size, window=window,
            min_count=min_count, seed=seed, workers=1, epochs=50,
        )
        self.vector_size = vector_size

    def _vector(self, tokens: list[str]) -> np.ndarray:
        vecs = [self.model.wv[t] for t in tokens if t in self.model.wv]
        if not vecs:
            return np.zeros(self.vector_size)
        return np.mean(vecs, axis=0)

    def embed(self, text: str) -> np.ndarray:
        tokens = preprocess(text).tokens_no_stop
        return self._vector(tokens)

    def embed_all(self, texts: list[str]) -> np.ndarray:
        return np.array([self.embed(t) for t in texts])

    def most_similar_words(self, word: str, topn: int = 5) -> list[dict]:
        word = word.lower()
        if word not in self.model.wv:
            return []
        return [{"word": w, "similarity": round(float(s), 4)} for w, s in self.model.wv.most_similar(word, topn=topn)]


class TfidfSvdEmbedder:
    method = "tfidf-svd"

    def __init__(self, texts: list[str], n_components: int = 32, seed: int = 42):
        cleaned = [" ".join(preprocess(t).tokens_no_stop) for t in texts]
        self.vectorizer = TfidfVectorizer(ngram_range=(1, 2), min_df=1)
        tfidf = self.vectorizer.fit_transform(cleaned)
        n_components = max(1, min(n_components, min(tfidf.shape) - 1)) if min(tfidf.shape) > 1 else 1
        self.svd = TruncatedSVD(n_components=n_components, random_state=seed)
        if tfidf.shape[0] == 1:
            # A single-document corpus (a low-volume ticker is a normal,
            # not edge-case, occurrence here) makes TruncatedSVD's
            # internal explained_variance_ratio_ compute 0/0, since
            # "variance" is undefined for one sample. We never read that
            # attribute — only .transform() output, which is still a
            # valid (if not very meaningful) projection — so this is
            # purely a noisy warning, not a correctness issue. Silenced
            # narrowly rather than globally so unrelated warnings still
            # surface.
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", category=RuntimeWarning)
                self.svd.fit(tfidf)
        else:
            self.svd.fit(tfidf)

    def embed(self, text: str) -> np.ndarray:
        cleaned = " ".join(preprocess(text).tokens_no_stop)
        tfidf_vec = self.vectorizer.transform([cleaned])
        return self.svd.transform(tfidf_vec)[0]

    def embed_all(self, texts: list[str]) -> np.ndarray:
        cleaned = [" ".join(preprocess(t).tokens_no_stop) for t in texts]
        tfidf = self.vectorizer.transform(cleaned)
        return self.svd.transform(tfidf)


class TransformerEmbedder:
    """Optional. Requires `pip install -r requirements-transformers.txt`
    (sentence-transformers + torch). Not available in this sandbox due to
    disk/network constraints — see NLP_SETUP.md."""

    method = "transformer-sentence-embeddings"
    MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"

    def __init__(self):
        from sentence_transformers import SentenceTransformer  # ImportError if absent
        self.model = SentenceTransformer(self.MODEL_NAME)

    def embed(self, text: str) -> np.ndarray:
        return self.model.encode([text])[0]

    def embed_all(self, texts: list[str]) -> np.ndarray:
        return self.model.encode(texts)


_transformer_embedder = None
_transformer_unavailable = False


def get_default_embedder(texts: list[str]):
    """Returns (embedder, method_name). Prefers transformer embeddings,
    falls back to TF-IDF+SVD, which is always available."""
    global _transformer_embedder, _transformer_unavailable
    if not _transformer_unavailable:
        try:
            if _transformer_embedder is None:
                _transformer_embedder = TransformerEmbedder()
            return _transformer_embedder, _transformer_embedder.method
        except ImportError:
            _transformer_unavailable = True
    embedder = TfidfSvdEmbedder(texts)
    return embedder, embedder.method


def cosine_sim(a: np.ndarray, b: np.ndarray) -> float:
    denom = (np.linalg.norm(a) * np.linalg.norm(b))
    if denom == 0:
        return 0.0
    return float(np.dot(a, b) / denom)
