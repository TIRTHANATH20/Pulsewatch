"""Loads an explicitly configured corpus or current ticker news from Yahoo Finance."""
from __future__ import annotations

import csv
import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path

from .. import market_data

logger = logging.getLogger(__name__)

REQUIRED_FIELDS = ("id", "headline", "text")
SAMPLE_NEWS_PATH = Path(__file__).resolve().parents[2] / "data" / "sample_news.csv"


@dataclass
class Article:
    id: str
    headline: str
    text: str
    date: str
    source: str
    ticker: str
    # Optional source URL; empty when the corpus has no URL column. The
    # chatbot only shows a link when this is non-empty (never invented).
    url: str = ""

    @property
    def full_text(self) -> str:
        return f"{self.headline}. {self.text}"


def _row_to_article(row: dict, row_number: int, source_path: Path) -> Article | None:
    """Builds an Article from a raw CSV/JSON row, or returns None (with a
    logged warning) if a required field is missing/blank. A single
    malformed row must not take down the whole corpus load — every
    endpoint that depends on the corpus would otherwise 500 on every
    request until the file is fixed."""
    missing = [f for f in REQUIRED_FIELDS if not str(row.get(f, "")).strip()]
    if missing:
        logger.warning(
            "Skipping malformed article at %s row %d: missing/blank required field(s) %s",
            source_path, row_number, missing,
        )
        return None
    return Article(
        id=str(row["id"]), headline=str(row["headline"]), text=str(row["text"]),
        date=str(row.get("date", "")), source=str(row.get("source", "")),
        ticker=str(row.get("ticker", "")),
        url=str(row.get("url", "") or ""),
    )


def load_corpus(path: Path | None = None) -> list[Article]:
    path = path or (
        Path(os.environ["NEWS_CORPUS_PATH"])
        if os.environ.get("NEWS_CORPUS_PATH")
        else None
    )
    if path is None:
        return []
    if not path.exists():
        return []

    articles: list[Article] = []
    try:
        if path.suffix == ".csv":
            with open(path, newline="", encoding="utf-8") as f:
                for i, row in enumerate(csv.DictReader(f), start=1):
                    article = _row_to_article(row, i, path)
                    if article is not None:
                        articles.append(article)
        elif path.suffix in (".json", ".jsonl"):
            with open(path, encoding="utf-8") as f:
                if path.suffix == ".jsonl":
                    rows = [json.loads(line) for line in f if line.strip()]
                else:
                    parsed = json.load(f)
                    rows = parsed if isinstance(parsed, list) else []
            for i, row in enumerate(rows, start=1):
                article = _row_to_article(row, i, path)
                if article is not None:
                    articles.append(article)
    except (csv.Error, json.JSONDecodeError, UnicodeDecodeError) as e:
        # A genuinely unparseable file (bad encoding, corrupt JSON, etc.)
        # degrades to "no corpus" rather than crashing every endpoint
        # that calls load_corpus() — consistent with the "missing
        # dataset -> empty state, not a crash" behavior above.
        logger.warning("Could not parse corpus file %s: %s", path, e)
        return []

    return articles


def corpus_info(path: Path | None = None) -> dict:
    """Report whether news comes from a supplied corpus or live Yahoo Finance lookups."""
    configured_path = path or (
        Path(os.environ["NEWS_CORPUS_PATH"])
        if os.environ.get("NEWS_CORPUS_PATH")
        else None
    )
    if configured_path is not None:
        kind = "sample" if configured_path.resolve() == SAMPLE_NEWS_PATH.resolve() else "custom"
        return {"kind": kind, "articleCount": len(load_corpus(configured_path))}
    return {"kind": "live", "articleCount": 0}


def articles_for_ticker(ticker: str, path: Path | None = None) -> list[Article]:
    ticker = ticker.upper()
    if path is not None or os.environ.get("NEWS_CORPUS_PATH"):
        return [a for a in load_corpus(path) if a.ticker.upper() == ticker]
    return [Article(**article) for article in market_data.fetch_news(ticker)]
