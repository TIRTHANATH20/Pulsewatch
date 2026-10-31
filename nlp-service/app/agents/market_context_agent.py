from fastapi import APIRouter
from pydantic import BaseModel, Field

from .. import market_data
from .models import AgentCard, AgentResult

router = APIRouter(prefix="/agents/market-context", tags=["agents"])
CARD = AgentCard(
    name="Market Context Agent",
    version="1.0.0",
    description="Retrieves a quote and recent price history for a stock ticker.",
    capabilities=["Quote retrieval", "Price history", "Data freshness"],
    inputs={"ticker": "Stock ticker or company symbol", "range": "1D, 1W, 1M, 3M, or 1Y"},
    outputs={"quote": "object", "history": "array"},
)


class MarketContextIn(BaseModel):
    ticker: str = Field(min_length=1, max_length=20)
    range: str = "1M"


@router.get("")
def card() -> dict:
    return CARD.model_dump()


@router.post("/run", response_model=AgentResult)
def run(payload: MarketContextIn) -> AgentResult:
    return AgentResult(
        agent=CARD.name,
        status="completed",
        result={
            "quote": market_data.fetch_quote(payload.ticker),
            "history": market_data.fetch_history(payload.ticker, payload.range.upper()),
        },
    )
