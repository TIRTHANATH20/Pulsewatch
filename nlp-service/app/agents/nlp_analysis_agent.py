from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..pipeline import aspect_sentiment, classification, events, ner, sentiment, preprocessing, tfidf
from .models import AgentCard, AgentResult

router = APIRouter(prefix="/agents/nlp-analysis", tags=["agents"])
CARD = AgentCard(
    name="NLP Analysis Agent",
    version="1.0.0",
    description="Runs PulseWatch's text analysis pipeline on financial text.",
    capabilities=["Sentiment", "Named entities", "Classification", "Events", "Keyphrases"],
    inputs={"text": "Financial text to analyze"},
    outputs={"sentiment": "object", "entities": "array", "events": "object"},
)


class NlpAnalysisIn(BaseModel):
    text: str = Field(min_length=1, max_length=20000)


@router.get("")
def card() -> dict:
    return CARD.model_dump()


@router.post("/run", response_model=AgentResult)
def run(payload: NlpAnalysisIn) -> AgentResult:
    text = payload.text
    return AgentResult(
        agent=CARD.name,
        status="completed",
        result={
            "preprocessing": preprocessing.preprocess(text).to_dict(),
            "sentiment": sentiment.predict_sentiment(text).__dict__,
            "entities": ner.extract_entities(text),
            "category": classification.classify_text(text),
            "aspects": aspect_sentiment.analyze_aspects(text),
            "events": events.extract_events(text),
            "keyphrases": tfidf.extract_keyphrases(text),
        },
    )
