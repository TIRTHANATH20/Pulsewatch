from fastapi import APIRouter
from pydantic import BaseModel, Field

from .models import AgentCard, AgentResult

router = APIRouter(prefix="/agents/verification", tags=["agents"])
CARD = AgentCard(
    name="Verification Agent",
    version="1.0.0",
    description="Checks whether an answer has evidence and citation markers.",
    capabilities=["Evidence presence", "Citation marker checks"],
    inputs={"answer": "Answer to verify", "source_count": "Number of available sources"},
    outputs={"verified": "boolean", "issues": "array"},
)


class VerificationIn(BaseModel):
    answer: str = Field(min_length=1, max_length=10000)
    source_count: int = Field(default=0, ge=0)


@router.get("")
def card() -> dict:
    return CARD.model_dump()


@router.post("/run", response_model=AgentResult)
def run(payload: VerificationIn) -> AgentResult:
    issues: list[str] = []
    if payload.source_count == 0:
        issues.append("No source evidence was supplied.")
    if payload.source_count > 0 and "[" not in payload.answer:
        issues.append("The answer contains no citation marker.")
    return AgentResult(
        agent=CARD.name,
        status="completed" if not issues else "passed_with_warnings",
        result={"verified": not issues, "issues": issues},
    )
