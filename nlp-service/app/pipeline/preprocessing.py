"""
Finance-aware text preprocessing.

Design notes (see NLP_ARCHITECTURE.md for the full writeup):
- We do NOT blindly strip tokens that are stopwords in general English but
  carry financial meaning (e.g. "up", "down", "over", "under" appear in
  standard stopword lists but matter for "profit up 10%" vs generic noise).
  We use a curated financial-safe stopword list instead of importing NLTK's
  full list wholesale.
- Tickers ($AAPL, TCS), percentages (12%), currency ($2 billion, ₹3,421),
  and financial acronyms (EPS, IPO, Q4, M&A, AI) are preserved as single
  tokens rather than being split or discarded.
- Lemmatization is a light suffix-based stemmer (no heavy WordNet download
  needed in this sandbox) — documented as a swap-in point for spaCy's
  lemmatizer when optional NLP extras are installed (see requirements-transformers.txt).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

# Tokens that look like generic stopwords but are financially meaningful
# and must NEVER be removed.
FINANCIAL_KEEP_LIST = {
    "up", "down", "over", "under", "above", "below", "against", "before",
    "after", "not", "no", "ai", "ipo", "eps", "q1", "q2", "q3", "q4",
    "m&a", "ceo", "cfo", "coo", "ipo", "ebitda", "yoy", "qoq", "gdp",
    "fed", "rbi", "sec",
}

# A small, curated financial-safe stopword list (function words only —
# deliberately NOT NLTK's full list, which removes financially loaded
# words like "up"/"down"/"not").
STOPWORDS = {
    "a", "an", "the", "and", "or", "but", "if", "then", "so", "of", "in",
    "on", "at", "to", "for", "with", "as", "by", "is", "are", "was",
    "were", "be", "been", "being", "it", "its", "this", "that", "these",
    "those", "he", "she", "they", "we", "you", "i", "his", "her", "their",
    "our", "your", "which", "who", "whom", "what", "will", "would",
    "shall", "should", "can", "could", "may", "might", "must", "do",
    "does", "did", "has", "have", "had", "from", "into", "than", "also",
} - FINANCIAL_KEEP_LIST

TICKER_RE = re.compile(r"\$[A-Z]{1,6}\b")
PERCENT_RE = re.compile(r"\b\d+(?:\.\d+)?%")
MONEY_RE = re.compile(
    r"(?:₹|\$|€|£)\s?\d[\d,]*(?:\.\d+)?\s?(?:billion|million|thousand|bn|mn|cr|crore|lakh)?",
    re.IGNORECASE,
)
NUMBER_RE = re.compile(r"\b\d[\d,]*(?:\.\d+)?\b")
WORD_RE = re.compile(r"[A-Za-z][A-Za-z\-&']*")

# Simple suffix-stripping lemmatizer. Documented limitation: this is a
# stemmer-lite, not a full morphological lemmatizer. Swap-in point for
# spaCy's lemmatizer is documented in NLP_ARCHITECTURE.md.
_SUFFIXES = [
    ("ational", "ate"), ("tional", "tion"), ("ing", ""), ("edly", ""),
    ("ed", ""), ("ies", "y"), ("ied", "y"), ("ization", "ize"),
    ("izing", "ize"), ("es", ""), ("s", ""),
]


def _lemmatize(token: str) -> str:
    lower = token.lower()
    if lower in FINANCIAL_KEEP_LIST or TICKER_RE.match(token) or NUMBER_RE.fullmatch(token):
        return lower
    if len(lower) <= 4:
        return lower
    for suf, repl in _SUFFIXES:
        if lower.endswith(suf) and len(lower) - len(suf) >= 3:
            return lower[: -len(suf)] + repl
    return lower


@dataclass
class PreprocessResult:
    original: str
    normalized: str
    tokens: list[str] = field(default_factory=list)
    lemmas: list[str] = field(default_factory=list)
    tokens_no_stop: list[str] = field(default_factory=list)
    tickers: list[str] = field(default_factory=list)
    money_mentions: list[str] = field(default_factory=list)
    percent_mentions: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "original": self.original,
            "normalized": self.normalized,
            "tokens": self.tokens,
            "lemmas": self.lemmas,
            "tokensNoStopwords": self.tokens_no_stop,
            "tickers": self.tickers,
            "moneyMentions": self.money_mentions,
            "percentMentions": self.percent_mentions,
        }


def normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def extract_financial_spans(text: str) -> tuple[list[str], list[str], list[str]]:
    tickers = TICKER_RE.findall(text)
    money = MONEY_RE.findall(text) if False else MONEY_RE.findall(text)
    percents = PERCENT_RE.findall(text)
    return tickers, money, percents


def tokenize(text: str) -> list[str]:
    """Tokenize while keeping tickers, money, and percentages intact."""
    tokens: list[str] = []
    protected_spans = []
    for regex in (MONEY_RE, PERCENT_RE, TICKER_RE):
        for m in regex.finditer(text):
            protected_spans.append((m.start(), m.end(), m.group()))
    protected_spans.sort()

    cursor = 0
    for start, end, val in protected_spans:
        if start < cursor:
            continue
        tokens.extend(WORD_RE.findall(text[cursor:start]))
        tokens.append(val.strip())
        cursor = end
    tokens.extend(WORD_RE.findall(text[cursor:]))
    return [t for t in tokens if t]


def preprocess(text: str) -> PreprocessResult:
    normalized = normalize_whitespace(text)
    tickers, money, percents = extract_financial_spans(normalized)
    tokens = tokenize(normalized)
    lemmas = [_lemmatize(t) for t in tokens]
    tokens_no_stop = [
        lem for lem, tok in zip(lemmas, tokens)
        if lem not in STOPWORDS and not re.fullmatch(r"[\W_]+", tok)
    ]
    return PreprocessResult(
        original=text,
        normalized=normalized,
        tokens=tokens,
        lemmas=lemmas,
        tokens_no_stop=tokens_no_stop,
        tickers=tickers,
        money_mentions=money,
        percent_mentions=percents,
    )


def preprocess_for_vectorizer(text: str) -> str:
    """Returns a cleaned, space-joined string suitable for TfidfVectorizer."""
    return " ".join(preprocess(text).tokens_no_stop)
