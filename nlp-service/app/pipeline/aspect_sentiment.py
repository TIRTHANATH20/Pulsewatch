"""
Aspect-based sentiment analysis (ABSA).

Approach: split text into clauses (on conjunctions like "but", "while",
"although", and sentence boundaries), detect which financial aspect each
clause is about via a keyword lexicon, then run the classical sentiment
model (sentiment.py) on that clause in isolation. This is a well
established, explainable ABSA pattern for small/no-training-data setups
(clause-level sentiment attribution) and is documented as such — it is
not a jointly-trained ABSA transformer, which is noted as a future
improvement in NLP_ARCHITECTURE.md.
"""
from __future__ import annotations

import re

from .sentiment import predict_sentiment

ASPECT_KEYWORDS = {
    "earnings": {"earnings", "profit", "income", "quarterly results"},
    "revenue": {"revenue", "sales", "turnover"},
    "hiring": {"hiring", "workforce", "headcount", "layoffs", "employees"},
    "product": {"product", "launch"},
    "management": {"ceo", "cfo", "leadership", "management", "board"},
    "regulation": {"regulator", "regulatory", "compliance", "lawsuit", "fine"},
    "technology": {"ai", "technology", "cloud", "software"},
    "guidance": {"guidance", "outlook", "forecast"},
    "customer demand": {"demand", "customer", "clients"},
}

CLAUSE_SPLIT_RE = re.compile(r"\b(but|while|although|however|whereas)\b", re.IGNORECASE)
SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")


def _split_clauses(text: str) -> list[str]:
    sentences = SENTENCE_SPLIT_RE.split(text)
    clauses = []
    for sent in sentences:
        parts = CLAUSE_SPLIT_RE.split(sent)
        # re.split with a capturing group returns the delimiters too;
        # keep only the non-delimiter chunks as clauses.
        clauses.extend(p.strip() for p in parts if p.strip() and p.lower() not in {"but", "while", "although", "however", "whereas"})
    return [c for c in clauses if c]


def _aspects_in_clause(clause: str) -> list[str]:
    lower = clause.lower()
    found = []
    for aspect, keywords in ASPECT_KEYWORDS.items():
        if any(kw in lower for kw in keywords):
            found.append(aspect)
    return found


def analyze_aspects(text: str) -> dict:
    clauses = _split_clauses(text)
    results = []
    for clause in clauses:
        aspects = _aspects_in_clause(clause)
        if not aspects:
            continue
        sentiment = predict_sentiment(clause)
        for aspect in aspects:
            results.append({
                "aspect": aspect,
                "clause": clause,
                "sentiment": sentiment.sentiment,
                "confidence": sentiment.confidence,
            })
    return {
        "text": text,
        "aspectSentiments": results,
        "method": "clause-segmentation + configured-sentiment-per-clause",
    }
