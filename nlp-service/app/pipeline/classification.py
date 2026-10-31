"""
Financial news category classification.

Categories: EARNINGS, M&A, PARTNERSHIP, PRODUCT, REGULATION, MANAGEMENT,
AI_TECHNOLOGY, MACROECONOMICS, OTHER.

Two-tier approach:
1. Optional TF-IDF + Logistic Regression, enabled only when
   `CLASSIFICATION_DATASET_PATH` points to labeled data.
2. Keyword rules when no trained model is configured or its confidence
   is low. The bundled sample is for tests/evaluation, not live requests.
"""
from __future__ import annotations

import csv
import os
from pathlib import Path

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score, precision_recall_fscore_support
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline

from .preprocessing import preprocess_for_vectorizer

CATEGORIES = [
    "EARNINGS", "M&A", "PARTNERSHIP", "PRODUCT", "REGULATION",
    "MANAGEMENT", "AI_TECHNOLOGY", "MACROECONOMICS", "OTHER",
]

DATA_PATH = Path(__file__).resolve().parents[2] / "data" / "sample_news_categories.csv"

RULE_KEYWORDS = {
    "EARNINGS": {"earnings", "revenue", "profit", "quarterly results", "quarter"},
    "M&A": {"acquisition", "acquired", "merger", "merged", "takeover"},
    "PARTNERSHIP": {"partnership", "collaborat", "tie-up", "alliance"},
    "PRODUCT": {"launch", "product", "unveil"},
    "REGULATION": {"regulator", "fine", "lawsuit", "compliance", "scrutiny", "sec "},
    "MANAGEMENT": {"ceo", "cfo", "resign", "appointed", "leadership"},
    "AI_TECHNOLOGY": {"ai", "artificial intelligence", "generative", "cloud", "azure"},
    "MACROECONOMICS": {"gdp", "inflation", "fed", "rbi", "interest rate", "macroeconomic"},
}


def _load_dataset(path: Path = DATA_PATH):
    texts, labels = [], []
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            texts.append(row["text"])
            labels.append(row["label"].strip())
    return texts, labels


class NewsClassifier:
    CONFIDENCE_THRESHOLD = 0.35

    def __init__(self, dataset_path: Path = DATA_PATH, random_state: int = 42):
        self.dataset_path = dataset_path
        self.random_state = random_state
        self._metrics = None
        self._fit()

    def _fit(self):
        texts, labels = _load_dataset(self.dataset_path)
        cleaned = [preprocess_for_vectorizer(t) for t in texts]
        present_labels = sorted(set(labels))

        X_train, X_test, y_train, y_test = train_test_split(
            cleaned, labels, test_size=0.3, random_state=self.random_state, stratify=labels,
        )
        pipeline = Pipeline([
            ("tfidf", TfidfVectorizer(ngram_range=(1, 2), min_df=1)),
            ("clf", LogisticRegression(max_iter=1000, class_weight="balanced")),
        ])
        pipeline.fit(X_train, y_train)
        preds = pipeline.predict(X_test)

        precision, recall, f1, _ = precision_recall_fscore_support(
            y_test, preds, labels=present_labels, average=None, zero_division=0,
        )
        self._metrics = {
            "modelType": "TF-IDF + Logistic Regression",
            "trainSize": len(X_train),
            "testSize": len(X_test),
            "accuracy": round(float(accuracy_score(y_test, preds)), 4),
            "macroF1": round(float(f1_score(y_test, preds, average="macro", zero_division=0)), 4),
            "perClass": {
                label: {"precision": round(float(p), 4), "recall": round(float(r), 4), "f1": round(float(f), 4)}
                for label, p, r, f in zip(present_labels, precision, recall, f1)
            },
            "note": f"Held-out metrics on a small sample ({len(texts)} labeled articles). See DATASET_SETUP.md to scale up.",
        }

        pipeline_full = Pipeline([
            ("tfidf", TfidfVectorizer(ngram_range=(1, 2), min_df=1)),
            ("clf", LogisticRegression(max_iter=1000, class_weight="balanced")),
        ])
        pipeline_full.fit(cleaned, labels)
        self.pipeline = pipeline_full

    def _rule_fallback(self, text: str) -> str:
        return _rule_classify_text(text)

    def predict(self, text: str) -> dict:
        cleaned = preprocess_for_vectorizer(text)
        proba = self.pipeline.predict_proba([cleaned])[0]
        classes = list(self.pipeline.classes_)
        prob_map = {c: float(p) for c, p in zip(classes, proba)}
        best_label = max(prob_map, key=prob_map.get)
        confidence = prob_map[best_label]

        if confidence < self.CONFIDENCE_THRESHOLD:
            rule_label = self._rule_fallback(text)
            return {
                "category": rule_label,
                "confidence": round(confidence, 4),
                "method": "rule-based-fallback",
                "modelProbabilities": {k: round(v, 4) for k, v in prob_map.items()},
                "note": "Classifier confidence below threshold; keyword rule backstop used instead.",
            }

        return {
            "category": best_label,
            "confidence": round(confidence, 4),
            "method": "classical-tfidf-logreg",
            "modelProbabilities": {k: round(v, 4) for k, v in prob_map.items()},
        }

    def evaluate(self) -> dict:
        return self._metrics


_singleton: NewsClassifier | None = None


def _rule_classify_text(text: str) -> str:
    lower = text.lower()
    for label, keywords in RULE_KEYWORDS.items():
        if any(keyword in lower for keyword in keywords):
            return label
    return "OTHER"


def get_classifier() -> NewsClassifier | None:
    global _singleton
    if _singleton is None:
        dataset_path = os.environ.get("CLASSIFICATION_DATASET_PATH")
        if not dataset_path:
            return None
        _singleton = NewsClassifier(Path(dataset_path))
    return _singleton


def classify_text(text: str) -> dict:
    classifier = get_classifier()
    if classifier is not None:
        return classifier.predict(text)
    return {
        "category": _rule_classify_text(text),
        "confidence": 0.0,
        "method": "rule-based-keywords",
        "modelProbabilities": {},
        "note": "No labeled dataset configured; keyword rules used without a trained classifier.",
    }
