"""
Named Entity Recognition for financial text.

Two paths:
1. `RuleBasedNER` (default, always available) — a gazetteer + regex
   recognizer covering ORGANIZATION (known tickers/company names +
   Title-Case heuristics), MONEY, PERCENT, DATE, and a curated
   TECHNOLOGY/TOPIC list (AI, cloud, etc). Deterministic and fully
   explainable, which is valuable for the "why did the model say that"
   requirement — but it will miss entities outside its gazetteer/heuristics.
2. `SpacyNER` (optional) — if `spacy` + a model (e.g. `en_core_web_sm`) is
   installed, delegates to spaCy's statistical NER for PERSON, GPE, ORG,
   DATE, MONEY, PERCENT recognition, then re-tags ORG spans that match our
   financial gazetteer more specifically. See NLP_SETUP.md to install.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from .preprocessing import MONEY_RE, PERCENT_RE, TICKER_RE

# Small gazetteer of known tickers/companies used across the sample
# dataset and demo. Extendable by loading Instrument.symbol/name from
# the PulseWatch DB (see /nlp-service/app/api/entities.py linkage note).
KNOWN_ORGS = {
    "tcs": "Tata Consultancy Services",
    "tata consultancy services": "Tata Consultancy Services",
    "microsoft": "Microsoft",
    "reliance": "Reliance Industries",
    "reliance industries": "Reliance Industries",
    "reliance jio": "Reliance Jio",
    "infosys": "Infosys",
    "hdfc": "HDFC Bank",
    "hdfc bank": "HDFC Bank",
    "hdfc ltd": "HDFC Ltd",
    "apple": "Apple",
    "aapl": "Apple",
}

TECH_TOPIC_TERMS = {
    "ai", "generative ai", "artificial intelligence", "cloud", "machine learning",
    "azure", "aws", "gpu", "data center", "chip", "semiconductor",
}

DATE_RE = re.compile(
    r"\b(?:\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,\s*\d{4})?|next quarter|this quarter|next year|Q[1-4]\s*\d{0,4})\b",
    re.IGNORECASE,
)

TITLECASE_RUN_RE = re.compile(r"\b([A-Z][a-zA-Z&\.]*(?:\s+[A-Z][a-zA-Z&\.]*){0,3})\b")

GENERIC_LEAD_WORDS = {"The", "A", "An", "This", "That", "It", "In", "On", "For", "With"}


@dataclass
class Entity:
    text: str
    label: str
    normalized: str | None = None
    start: int | None = None
    end: int | None = None

    def to_dict(self):
        d = {"text": self.text, "label": self.label}
        if self.normalized:
            d["normalized"] = self.normalized
        return d


class RuleBasedNER:
    label = "rule-based"

    def extract(self, text: str) -> list[Entity]:
        entities: list[Entity] = []
        lower = text.lower()

        for match in TICKER_RE.finditer(text):
            entities.append(Entity(match.group(), "ORGANIZATION", normalized=match.group().lstrip("$")))

        for key, canonical in KNOWN_ORGS.items():
            for m in re.finditer(rf"\b{re.escape(key)}\b", lower):
                entities.append(Entity(text[m.start():m.end()], "ORGANIZATION", normalized=canonical))

        for m in MONEY_RE.finditer(text):
            entities.append(Entity(m.group().strip(), "MONEY"))

        for m in PERCENT_RE.finditer(text):
            entities.append(Entity(m.group(), "PERCENT"))

        for m in DATE_RE.finditer(text):
            entities.append(Entity(m.group(), "DATE"))

        for term in TECH_TOPIC_TERMS:
            for m in re.finditer(rf"\b{re.escape(term)}\b", lower):
                entities.append(Entity(text[m.start():m.end()], "TECHNOLOGY", normalized=term.upper() if len(term) <= 3 else term.title()))

        # Fallback heuristic ORG/PERSON detection for Title Case runs not
        # already captured, excluding sentence-initial generic words.
        for m in TITLECASE_RUN_RE.finditer(text):
            span = m.group(1)
            if span in GENERIC_LEAD_WORDS:
                continue
            if span.lower() in KNOWN_ORGS:
                continue
            if len(span.split()) >= 2 and not any(e.text == span for e in entities):
                entities.append(Entity(span, "ORGANIZATION_CANDIDATE"))

        # De-duplicate identical (text, label) pairs while preserving order.
        seen = set()
        deduped = []
        for e in entities:
            key = (e.text.lower(), e.label)
            if key in seen:
                continue
            seen.add(key)
            deduped.append(e)
        return deduped


class SpacyNER:
    """Optional spaCy-backed NER. Requires `pip install spacy` and
    `python -m spacy download en_core_web_sm` (network access to spaCy's
    model host required — not available in this sandbox)."""

    label = "spacy"

    def __init__(self, model_name: str = "en_core_web_sm"):
        import spacy  # raises ImportError if not installed
        self.nlp = spacy.load(model_name)  # raises OSError if model missing

    SPACY_LABEL_MAP = {
        "ORG": "ORGANIZATION", "PERSON": "PERSON", "GPE": "LOCATION",
        "LOC": "LOCATION", "MONEY": "MONEY", "PERCENT": "PERCENT",
        "DATE": "DATE", "PRODUCT": "PRODUCT",
    }

    def extract(self, text: str) -> list[Entity]:
        doc = self.nlp(text)
        out = []
        for ent in doc.ents:
            label = self.SPACY_LABEL_MAP.get(ent.label_, ent.label_)
            normalized = KNOWN_ORGS.get(ent.text.lower()) if label == "ORGANIZATION" else None
            out.append(Entity(ent.text, label, normalized=normalized, start=ent.start_char, end=ent.end_char))
        return out


_spacy_singleton = None
_spacy_unavailable = False


def get_ner_engine():
    global _spacy_singleton, _spacy_unavailable
    if not _spacy_unavailable and _spacy_singleton is None:
        try:
            _spacy_singleton = SpacyNER()
        except Exception:
            _spacy_unavailable = True
    return _spacy_singleton or RuleBasedNER()


def extract_entities(text: str) -> dict:
    engine = get_ner_engine()
    entities = engine.extract(text)
    return {
        "engine": engine.label,
        "entities": [e.to_dict() for e in entities],
    }
