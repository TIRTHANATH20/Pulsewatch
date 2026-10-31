import { describe, expect, it } from "vitest";
import { buildHistory, readChatStream, upsertProgress, type ProgressStep } from "@/app/components/chat-client";
import { safeHttpUrl } from "@/lib/safe-url";
import type { ProgressEvent } from "@/server/modules/chat/types";

const enc = new TextEncoder();
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}
const RESULT = {
  conversation_id: "c1",
  answer: "hi",
  agents: [],
  sources: [],
  data_freshness: { generated_at: "2026-10-24T00:00:00.000Z", market: [], news: null },
  verification: { status: "passed", issues: [] },
  generation: { mode: "none", provider: null, model: null, reason: null },
  tickers: ["TCS"],
};

describe("readChatStream", () => {
  it("reassembles events split across chunk boundaries and returns the result", async () => {
    const lines = [
      JSON.stringify({ type: "progress", agent_id: "market_context", label: "Retrieving market context", state: "running" }),
      JSON.stringify({ type: "progress", agent_id: "market_context", label: "Retrieving market context", state: "done", status: "completed" }),
      JSON.stringify({ type: "result", data: RESULT }),
    ].join("\n") + "\n";
    const cut = [lines.slice(0, 17), lines.slice(17, 120), lines.slice(120)];
    const seen: string[] = [];
    const res = await readChatStream(streamOf(cut), (e) => seen.push(e.type));
    expect(seen).toEqual(["progress", "progress", "result"]);
    expect(res.conversation_id).toBe("c1");
  });

  it("handles a final result line without a trailing newline", async () => {
    const res = await readChatStream(streamOf([JSON.stringify({ type: "result", data: RESULT })]), () => {});
    expect(res.answer).toBe("hi");
  });

  it("throws the server's message on an error event", async () => {
    const body = streamOf([JSON.stringify({ type: "error", message: "PulseWatch AI could not complete this request." }) + "\n"]);
    await expect(readChatStream(body, () => {})).rejects.toThrow("could not complete");
  });

  it("throws when the stream ends without a result (never shows a half answer)", async () => {
    const body = streamOf([JSON.stringify({ type: "progress", agent_id: "explanation", label: "x", state: "running" }) + "\n"]);
    await expect(readChatStream(body, () => {})).rejects.toThrow("ended before an answer");
  });

  it("turns invalid JSON into a readable error, not a raw SyntaxError", async () => {
    const err = await readChatStream(streamOf(["{not json\n"]), () => {}).catch((e) => e);
    expect(err.message).toMatch(/could not be read/);
    expect(err.message).not.toMatch(/Unexpected token/);
  });

  it("rejects valid JSON with a malformed result contract", async () => {
    const body = streamOf([JSON.stringify({ type: "result", data: { answer: "incomplete" } }) + "\n"]);
    await expect(readChatStream(body, () => {})).rejects.toThrow(/invalid response/i);
  });

  it("rejects unknown event types instead of passing them to the UI", async () => {
    const body = streamOf([JSON.stringify({ type: "progressish", agent_id: "market_context" }) + "\n"]);
    await expect(readChatStream(body, () => {})).rejects.toThrow(/invalid response/i);
  });
});

describe("upsertProgress", () => {
  const ev = (agent_id: ProgressStep["agent_id"], state: "running" | "done", status?: ProgressStep["status"]) =>
    ({ type: "progress", agent_id, label: agent_id, state, status }) as Extract<ProgressEvent, { type: "progress" }>;
  it("updates an agent in place instead of reordering the list", () => {
    let steps: ProgressStep[] = [];
    steps = upsertProgress(steps, ev("market_context", "running"));
    steps = upsertProgress(steps, ev("news_research", "running"));
    steps = upsertProgress(steps, ev("market_context", "done", "completed"));
    expect(steps.map((s) => s.agent_id)).toEqual(["market_context", "news_research"]);
    expect(steps[0]).toMatchObject({ state: "done", status: "completed" });
    expect(steps[1]).toMatchObject({ state: "running" });
  });
});

describe("buildHistory (follow-up context sent to the server)", () => {
  it("keeps only finished, non-error turns, newest 10, with resolved tickers", () => {
    const msgs = [
      { role: "user" as const, content: "Why is TCS moving?" },
      { role: "assistant" as const, content: "answer", response: { tickers: ["TCS"] } },
      { role: "assistant" as const, content: "", pending: true },
      { role: "assistant" as const, content: "boom", error: true },
    ];
    const h = buildHistory(msgs);
    expect(h).toEqual([
      { role: "user", content: "Why is TCS moving?", tickers: undefined },
      { role: "assistant", content: "answer", tickers: ["TCS"] },
    ]);
    const many = Array.from({ length: 30 }, (_, i) => ({ role: "user" as const, content: `m${i}` }));
    expect(buildHistory(many)).toHaveLength(10);
    expect(buildHistory(many)[9]!.content).toBe("m29");
  });
  it("truncates very long content to stay within the API limit", () => {
    expect(buildHistory([{ role: "assistant", content: "x".repeat(9000) }])[0]!.content.length).toBe(4000);
  });
});

describe("safeHttpUrl", () => {
  it("allows http(s) only", () => {
    expect(safeHttpUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(safeHttpUrl("http://example.com")).toBe("http://example.com/");
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "ftp://x.com", "not a url", "", null, undefined]) {
      expect(safeHttpUrl(bad as string | null | undefined), String(bad)).toBeNull();
    }
  });
});
