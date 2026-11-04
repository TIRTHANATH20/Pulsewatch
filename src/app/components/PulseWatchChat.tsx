"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { safeHttpUrl } from "@/lib/safe-url";
import type { AgentStatus, ChatResponse } from "@/server/modules/chat/types";
import {
  buildHistory,
  readChatStream,
  upsertProgress,
  type ProgressStep,
} from "./chat-client";

// The one and only PulseWatch AI chat interface. All questions and answers
// live in this single conversation; the agents run behind the backend
// orchestrator (POST /api/chat) and are surfaced only as progress steps
// and compact answer details.

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  response?: ChatResponse;
  progress?: ProgressStep[];
  pending?: boolean;
  error?: boolean;
}

const STORAGE_KEY = "pw-chat-v1";
const SUGGESTIONS = [
  "Why is TCS moving?",
  "What's the latest news on INFY?",
  "What is RELIANCE trading at?",
  "Summarize sentiment and events for HDFC",
];

const STATUS_LABEL: Record<AgentStatus, string> = {
  completed: "Completed",
  skipped: "Skipped",
  failed: "Failed",
  insufficient_evidence: "Insufficient Evidence",
};

function uid() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadSaved(): { conversationId: string | null; messages: Message[] } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.messages)) {
        // A request that was in flight when the page closed can never finish.
        const messages = (parsed.messages as Message[]).filter(
          (m) => !m.pending,
        );
        return { conversationId: parsed.conversationId ?? null, messages };
      }
    }
  } catch {
    /* storage unavailable: start fresh */
  }
  return { conversationId: null, messages: [] };
}

function AnswerText({
  text,
  response,
}: {
  text: string;
  response?: ChatResponse;
}) {
  const parts = text.replace(/\[M?\d+\]/g, "").split(/(\[M?\d+\])/g);
  return (
    <p className="pwchat-answer">
      {parts.map((part, i) => {
        const m = part.match(/^\[(M?\d+)\]$/);
        if (!m) return <span key={i}>{part}</span>;
        const src = response?.sources.find((s) => s.ref === m[1]);
        const href = safeHttpUrl(src?.url);
        return href ? (
          <a
            key={i}
            className="pwchat-cite"
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            title={src?.title}
          >
            {part}
          </a>
        ) : (
          <sup key={i} className="pwchat-cite" title={src?.title ?? "source"}>
            {part}
          </sup>
        );
      })}
    </p>
  );
}

function AssistantBody({ msg }: { msg: Message }) {
  const r = msg.response;
  if (msg.pending) {
    return (
      <div role="status" aria-live="polite">
        <p className="pwchat-title">PulseWatch AI</p>
        <ul className="pwchat-progress">
          {(msg.progress ?? []).map((p) => (
            <li
              key={p.agent_id}
              className={p.state === "done" ? "is-done" : "is-running"}
            >
              <span aria-hidden="true">{p.state === "done" ? "✓" : "…"}</span>{" "}
              {p.label}
              {p.state === "done" && p.status && p.status !== "completed"
                ? ` — ${STATUS_LABEL[p.status]}`
                : ""}
            </li>
          ))}
          {(msg.progress ?? []).length === 0 && (
            <li className="is-running">Planning which agents are needed…</li>
          )}
        </ul>
      </div>
    );
  }
  if (!r) {
    return (
      <p className={msg.error ? "pwchat-error" : undefined}>{msg.content}</p>
    );
  }

  const ran = r.agents.filter((a) => a.status !== "skipped");
  const hasWarnings =
    r.verification.status !== "passed" ||
    r.generation.mode !== "llm";

  return (
    <div>
      <div className="pwchat-answer-heading">
        <p className="pwchat-title">PulseWatch AI</p>
        {hasWarnings && (
          <span
            className={`pwchat-badge ${r.generation.mode === "fallback" ? "is-fallback" : "is-v-passed_with_warnings"}`}
            title={
              r.generation.reason ?? r.verification.status.replace(/_/g, " ")
            }
          >
            {r.generation.mode === "fallback"
              ? "Using evidence-only answer"
              : "Checked with warnings"}
          </span>
        )}
      </div>

      {r.answer.split(/\n\n(?=Data notes:)/).map((block, i) =>
        block.startsWith("Data notes:") ? (
          <ul key={i} className="pwchat-notes">
            {block
              .split("\n")
              .slice(1)
              .map((l, j) => (
                <li key={j}>{l.replace(/^-\s*/, "")}</li>
              ))}
          </ul>
        ) : (
          block
            .split("\n")
            .map((l, j) => (
              <AnswerText key={`${i}-${j}`} text={l} response={r} />
            ))
        ),
      )}

      <details className="pwchat-details">
        <summary>
          Answer details{" "}
          <span className="pwchat-muted">({ran.length} checks)</span>
        </summary>
        <ul className="pwchat-agents">
          {r.agents.map((a) => (
            <li key={a.agent_id}>
              <div className="pwchat-agent-head">
                <strong>{a.agent_name}</strong>
                <span className={`pwchat-status is-${a.status}`}>
                  {STATUS_LABEL[a.status]}
                </span>
              </div>
              <div>{a.summary}</div>
            </li>
          ))}
        </ul>
      </details>

      {r.verification.issues.length > 0 && (
        <details className="pwchat-details">
          <summary>
            Verification details{" "}
            <span className="pwchat-muted">
              ({r.verification.issues.length})
            </span>
          </summary>
          <ul className="pwchat-sources">
            {r.verification.issues.map((i, k) => (
              <li key={k}>
                <span className={`pwchat-status is-sev-${i.severity}`}>
                  {i.severity}
                </span>{" "}
                {i.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export default function PulseWatchChat({
  initialQuestion,
}: {
  initialQuestion?: string;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState(initialQuestion ?? "");
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = loadSaved();
    setMessages(saved.messages);
    setConversationId(saved.conversationId);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          conversationId,
          messages: messages.filter((m) => !m.pending),
        }),
      );
    } catch {
      /* ignore */
    }
  }, [messages, conversationId, hydrated]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [messages]);

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || busy) return;
      setInput("");
      setBusy(true);

      const history = buildHistory(messages);
      const assistantId = uid();
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: "user", content: question },
        {
          id: assistantId,
          role: "assistant",
          content: "",
          pending: true,
          progress: [],
        },
      ]);

      const patch = (fn: (m: Message) => Message) =>
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? fn(m) : m)),
        );

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: question,
            conversation_id: conversationId?.trim() || undefined,
            history,
            stream: true,
          }),
        });
        if (!res.ok || !res.body) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.message ?? `Request failed (${res.status})`);
        }
        await readChatStream(res.body, (event) => {
          if (event.type === "progress") {
            patch((m) => ({
              ...m,
              progress: upsertProgress(m.progress ?? [], event),
            }));
          } else if (event.type === "result") {
            setConversationId(event.data.conversation_id);
            patch((m) => ({
              ...m,
              pending: false,
              content: event.data.answer,
              response: event.data,
              progress: undefined,
            }));
          }
        });
      } catch (err) {
        patch((m) => ({
          ...m,
          pending: false,
          error: true,
          progress: undefined,
          content:
            err instanceof Error
              ? err.message
              : "Something went wrong. Please try again.",
        }));
      } finally {
        setBusy(false);
      }
    },
    [busy, messages, conversationId],
  );

  function reset() {
    setMessages([]);
    setConversationId(null);
  }

  return (
    <section className="pwchat liquid-glass" aria-label="PulseWatch AI chat">
      <header className="pwchat-header">
        <div>
          <h1 className="pwchat-h1">PulseWatch AI</h1>
          <p className="pwchat-muted">
            Ask about a company or ticker to get a concise, evidence-backed
            market answer.
          </p>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={reset}
            disabled={busy}
          >
            New conversation
          </button>
        )}
      </header>

      <div className="pwchat-log" aria-live="off">
        {hydrated && messages.length === 0 && (
          <div className="pwchat-empty">
            <p>Ask about a stock. Try:</p>
            <div className="pwchat-suggestions">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="btn"
                  onClick={() => send(s)}
                  disabled={busy}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`pwchat-msg is-${m.role}`}>
            {m.role === "user" ? <p>{m.content}</p> : <AssistantBody msg={m} />}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form
        className="pwchat-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input
          className="input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask PulseWatch AI — e.g. “Why is TCS moving?”"
          aria-label="Message PulseWatch AI"
          maxLength={2000}
          disabled={busy}
        />
        <button
          className="btn btn-primary"
          type="submit"
          disabled={busy || !input.trim()}
        >
          {busy ? "Working…" : "Send"}
        </button>
      </form>
    </section>
  );
}
