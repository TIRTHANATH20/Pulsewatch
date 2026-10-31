import { getEnv } from "@/server/lib/env";
import { NlpUnavailableError } from "@/server/modules/nlp/errors";
import type { ChatRequest, ChatResponse, ProgressEvent } from "./types";

export async function runPythonChat(
  request: ChatRequest,
  knownSymbols: string[],
  onEvent?: (event: ProgressEvent) => void,
): Promise<ChatResponse> {
  const env = getEnv();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.NLP_SERVICE_TIMEOUT_MS);
  try {
    for (const [agent_id, label] of [
      ["market_context", "Retrieving market context"],
      ["news_research", "Searching financial news"],
      ["nlp_analysis", "Analyzing news with NLP"],
      ["evidence_rag", "Retrieving supporting evidence"],
      ["explanation", "Generating the explanation"],
      ["verification", "Verifying the answer"],
    ] as const) {
      onEvent?.({ type: "progress", agent_id, label, state: "running" });
    }
    const response = await fetch(`${env.NLP_SERVICE_URL}/chat/graph`, {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: request.message,
        history: request.history,
        known_symbols: knownSymbols,
      }),
    });
    if (!response.ok) throw new Error(`NLP service returned ${response.status}`);
    const data = (await response.json()) as ChatResponse;
    for (const agent of data.agents) {
      onEvent?.({
        type: "progress",
        agent_id: agent.agent_id,
        label: agent.agent_name,
        state: "done",
        status: agent.status,
      });
    }
    return {
      ...data,
      conversation_id:
        request.conversation_id?.trim() || data.conversation_id || crypto.randomUUID(),
    };
  } catch (error) {
    throw new NlpUnavailableError(
      error instanceof Error && error.name === "AbortError"
        ? "NLP service timed out"
        : "Could not reach the Python LangGraph service",
    );
  } finally {
    clearTimeout(timeout);
  }
}
