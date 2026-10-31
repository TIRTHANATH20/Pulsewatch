import { z } from "zod";
import { AGENT_IDS, agentStatusSchema, chatResponseSchema } from "@/server/modules/chat/types";
import type { AgentId, AgentStatus, ChatResponse, ProgressEvent } from "@/server/modules/chat/types";

// Pure helpers behind PulseWatchChat (no React, no DOM) so the streaming
// protocol and follow-up context handling can be unit-tested.

export interface ProgressStep {
  agent_id: AgentId;
  label: string;
  state: "running" | "done";
  status?: AgentStatus;
}

export interface HistorySource {
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
  error?: boolean;
  response?: { tickers?: string[] };
}

const HISTORY_TURNS = 10;
const HISTORY_CONTENT_MAX = 4000;
const streamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("progress"),
    agent_id: z.enum(AGENT_IDS),
    label: z.string(),
    state: z.enum(["running", "done"]),
    status: agentStatusSchema.optional(),
  }),
  z.object({ type: z.literal("result"), data: chatResponseSchema }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);

// The transcript sent back with each question so follow-ups keep their
// subject: only finished, non-error turns, the most recent few, each with the
// tickers the assistant resolved for it.
export function buildHistory(messages: HistorySource[]) {
  return messages
    .filter((m) => !m.pending && !m.error)
    .slice(-HISTORY_TURNS)
    .map((m) => ({
      role: m.role,
      content: m.content.slice(0, HISTORY_CONTENT_MAX),
      tickers: m.response?.tickers?.length ? m.response.tickers : undefined,
    }));
}

// Updates one agent's step in place. Keeping its position matters: the list
// must not reshuffle every time an agent moves from "running" to "done".
export function upsertProgress(
  steps: ProgressStep[],
  event: Extract<ProgressEvent, { type: "progress" }>,
): ProgressStep[] {
  const next: ProgressStep = { agent_id: event.agent_id, label: event.label, state: event.state, status: event.status };
  const i = steps.findIndex((s) => s.agent_id === event.agent_id);
  if (i === -1) return [...steps, next];
  const copy = [...steps];
  copy[i] = next;
  return copy;
}

// Reads the NDJSON body of POST /api/chat (stream: true). Calls `onEvent` for
// every event and resolves with the final ChatResponse. Throws a readable
// Error when the server reports an error, a line is not valid JSON, or the
// stream ends without a result — the UI must never show a half-finished
// answer as if it were complete.
export async function readChatStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ProgressEvent) => void,
): Promise<ChatResponse> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: ChatResponse | null = null;

  const handle = (line: string) => {
    if (!line.trim()) return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new Error("PulseWatch AI sent a response that could not be read. Please try again.");
    }
    const parsed = streamEventSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error("PulseWatch AI sent an invalid response. Please try again.");
    }
    const event: ProgressEvent = parsed.data;
    if (event.type === "error") throw new Error(event.message);
    if (event.type === "result") result = event.data;
    onEvent(event);
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) handle(line);
  }
  buffer += decoder.decode();
  if (buffer.trim()) handle(buffer);

  if (!result) throw new Error("The response ended before an answer was produced.");
  return result;
}
