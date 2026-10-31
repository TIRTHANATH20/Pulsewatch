from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..pipeline.rag import answer_query
from .models import AgentCard, AgentResult

router = APIRouter(prefix="/agents/explanation", tags=["agents"])
CARD = AgentCard(
    name="Financial Explanation Agent",
    version="1.0.0",
    description="Produces an evidence-grounded explanation from retrieved financial news.",
    capabilities=["Grounded explanation", "Source citations", "Insufficient-evidence handling"],
    inputs={"query": "User question", "ticker": "Optional ticker"},
    outputs={"answer": "string", "sources": "array", "generation": "string"},
)


class ExplanationIn(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    ticker: str | None = None


@router.get("")
def card() -> dict:
    return CARD.model_dump()


@router.post("/run", response_model=AgentResult)
def run(payload: ExplanationIn) -> AgentResult:
    result = answer_query(payload.query, payload.ticker, 5, generate=True)
    return AgentResult(agent=CARD.name, status="completed" if result["sources"] else "insufficient_evidence", result=result)
