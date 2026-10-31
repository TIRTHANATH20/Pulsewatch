from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..pipeline.rag import answer_query
from .models import AgentCard, AgentResult

router = APIRouter(prefix="/agents/evidence-rag", tags=["agents"])
CARD = AgentCard(
    name="Evidence Retrieval Agent",
    version="1.0.0",
    description="Retrieves relevant evidence from the indexed financial news corpus.",
    capabilities=["Vector retrieval", "Ticker filtering", "Source references"],
    inputs={"query": "Question or search phrase", "ticker": "Optional ticker", "top_k": "Result count"},
    outputs={"retrievedDocuments": "array", "sources": "array", "confidence": "float"},
)


class EvidenceRagIn(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    ticker: str | None = None
    top_k: int = Field(default=5, ge=1, le=20)


@router.get("")
def card() -> dict:
    return CARD.model_dump()


@router.post("/run", response_model=AgentResult)
def run(payload: EvidenceRagIn) -> AgentResult:
    result = answer_query(payload.query, payload.ticker, payload.top_k, generate=False)
    return AgentResult(agent=CARD.name, status="completed" if result["sources"] else "insufficient_evidence", result=result)
