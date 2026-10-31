from pydantic import BaseModel, Field


class TextIn(BaseModel):
    text: str = Field(min_length=1, max_length=20000)


class TickerNewsIn(BaseModel):
    ticker: str
    top_k: int = 5


class RagQueryIn(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    ticker: str | None = None
    top_k: int = Field(default=5, ge=1, le=20)
    # False = retrieval only: skip the (slow, billable) LLM generation step.
    # The PulseWatch AI chatbot writes its own answer and only needs evidence.
    generate: bool = True


class AttentionSignalsIn(BaseModel):
    ticker: str
    percentChange: float
