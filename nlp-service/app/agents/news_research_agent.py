from fastapi import APIRouter
from pydantic import BaseModel, Field

from .. import market_data
from .models import AgentCard, AgentResult

router = APIRouter(prefix="/agents/news-research", tags=["agents"])
CARD = AgentCard(
    name="Financial News Research Agent",
    version="1.0.0",
    description="Retrieves current ticker-related financial news with source metadata.",
    capabilities=["Ticker news", "Source metadata", "Publication dates"],
    inputs={"ticker": "Stock ticker or company symbol", "count": "Maximum article count"},
    outputs={"articles": "array", "count": "integer"},
)


class NewsResearchIn(BaseModel):
    ticker: str = Field(min_length=1, max_length=20)
    count: int = Field(default=10, ge=1, le=50)


@router.get("")
def card() -> dict:
    return CARD.model_dump()


@router.post("/run", response_model=AgentResult)
def run(payload: NewsResearchIn) -> AgentResult:
    articles = market_data.fetch_news(payload.ticker, payload.count)
    return AgentResult(
        agent=CARD.name,
        status="completed" if articles else "insufficient_evidence",
        result={"ticker": payload.ticker.upper(), "count": len(articles), "articles": articles},
    )
