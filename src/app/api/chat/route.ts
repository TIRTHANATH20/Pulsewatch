import { NextResponse } from "next/server";
import { errorResponse, readJsonBody } from "@/server/lib/api-response";
import {
  getAuthenticatedUserId,
  getCurrentUser,
} from "@/server/lib/current-user";
import { prisma } from "@/server/db/prisma";
import { getEnv } from "@/server/lib/env";
import {
  chatRequestSchema,
  type ProgressEvent,
} from "@/server/modules/chat";
import { runPythonChat } from "@/server/modules/chat/python-agent-client";
import { allowChatRequest, clientKey } from "@/server/modules/chat/rate-limit";

export const dynamic = "force-dynamic";

// Symbols the signed-in user already tracks, used only to improve ticker
// detection. Best-effort: a missing user or unreachable database must not
// stop the chatbot (it can answer without watchlist context).
async function loadKnownSymbols(): Promise<string[]> {
  try {
    const user = await getCurrentUser();
    if (!user) return [];
    const items = await prisma.watchlistItem.findMany({
      where: { watchlist: { userId: user.id } },
      select: { instrument: { select: { symbol: true } } },
      take: 200,
    });
    return [...new Set(items.map((i) => i.instrument.symbol))];
  } catch {
    return [];
  }
}

// POST /api/chat — the single entry point of the PulseWatch AI chatbot.
// With `stream: true` the response is newline-delimited JSON: one
// `progress` event per real agent start/finish, then one `result` event
// carrying the full validated ChatResponse. Without it, the same
// ChatResponse is returned as plain JSON.
export async function POST(req: Request) {
  try {
    await getAuthenticatedUserId();
  } catch (err) {
    return errorResponse(err);
  }

  let limitPerMinute = 20;
  try {
    limitPerMinute = getEnv().CHAT_RATE_LIMIT_PER_MINUTE;
  } catch {
    /* invalid env is reported by the handlers that need it; keep the default limit */
  }
  if (!allowChatRequest(clientKey(req.headers), limitPerMinute)) {
    return NextResponse.json(
      {
        error: "RateLimited",
        message: "Too many chat requests. Please wait a minute and try again.",
      },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  let body;
  try {
    body = chatRequestSchema.parse(await readJsonBody(req));
  } catch (err) {
    return errorResponse(err);
  }

  const knownSymbols = await loadKnownSymbols();
  if (!body.stream) {
    try {
      return NextResponse.json(await runPythonChat(body, knownSymbols));
    } catch (err) {
      return errorResponse(err);
    }
  }

  const encoder = new TextEncoder();
  // Set when the browser disconnects: enqueueing on a cancelled stream
  // throws, so every write goes through `send`, which then becomes a no-op.
  let closed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: ProgressEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true;
        }
      };
      try {
        const data = await runPythonChat(body, knownSymbols, send);
        send({ type: "result", data });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("Chat orchestration error:", err);
        send({
          type: "error",
          message: "PulseWatch AI could not complete this request.",
        });
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      }
    },
    cancel() {
      closed = true;
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
