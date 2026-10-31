from pydantic import BaseModel


class AgentCard(BaseModel):
    name: str
    version: str
    description: str
    capabilities: list[str]
    inputs: dict[str, str]
    outputs: dict[str, str]


class AgentResult(BaseModel):
    agent: str
    status: str
    result: dict
