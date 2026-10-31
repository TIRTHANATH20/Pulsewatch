import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  NotFoundError,
  DuplicateItemError,
  UnauthorizedError,
  ValidationError,
} from "@/server/modules/watchlist/errors";
import {
  NlpUnavailableError,
  NlpDisabledError,
} from "@/server/modules/nlp/errors";

// Consistent JSON error shape across every API route:
// { error: "<MachineReadableKind>", message: "<human readable>", issues?: [...] }
//
// Route handlers should wrap their logic in try/catch and call this in the
// catch block — see src/app/api/watchlists/**/route.ts for the pattern.
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        error: "ValidationError",
        message: err.issues[0]?.message ?? "Invalid request",
        issues: err.issues,
      },
      { status: 400 },
    );
  }

  if (err instanceof ValidationError) {
    return NextResponse.json(
      { error: "ValidationError", message: err.message },
      { status: 400 },
    );
  }

  if (err instanceof NotFoundError) {
    return NextResponse.json(
      { error: "NotFound", message: err.message },
      { status: 404 },
    );
  }

  if (err instanceof DuplicateItemError) {
    return NextResponse.json(
      { error: "Conflict", message: err.message },
      { status: 409 },
    );
  }

  if (err instanceof UnauthorizedError) {
    return NextResponse.json(
      { error: "Unauthorized", message: err.message },
      { status: 401 },
    );
  }

  // NLP is an optional enhancement layer (see PROJECT_SPEC.md / rule
  // "Make NLP optional if dependencies/models are unavailable"). Both of
  // these are expected, recoverable states — not application bugs — so
  // they get their own machine-readable `error` kinds and a 200-friendly
  // 503 rather than falling through to the generic 500 handler, letting
  // the UI show "NLP intelligence unavailable" instead of a hard error.
  if (err instanceof NlpDisabledError) {
    return NextResponse.json(
      { error: "NlpDisabled", message: err.message },
      { status: 503 },
    );
  }

  if (err instanceof NlpUnavailableError) {
    return NextResponse.json(
      { error: "NlpUnavailable", message: err.message },
      { status: 503 },
    );
  }

  // eslint-disable-next-line no-console
  console.error("Unhandled API error:", err);

  // Prisma's connection-level error codes (can't reach the database
  // server, auth failure, database doesn't exist, timed out). Surfacing
  // this distinctly — instead of the generic 500 below — is the single
  // most useful thing this handler can do for local setup: "watchlist is
  // broken" during development is overwhelmingly "Postgres isn't running
  // / DATABASE_URL is wrong", not an application bug, and the generic
  // message gave no way to tell the two apart.
  if (isDatabaseUnavailable(err)) {
    return NextResponse.json(
      {
        error: "DatabaseUnavailable",
        message:
          "Can't reach the database. Check that Postgres is running and DATABASE_URL in .env is correct, then run `npm run prisma:migrate`.",
      },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { error: "InternalError", message: "Something went wrong" },
    { status: 500 },
  );
}

function isDatabaseUnavailable(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = "code" in err ? (err as { code?: unknown }).code : undefined;
  // P1000: auth failed, P1001: can't reach server, P1002: timed out,
  // P1003: database does not exist, P1008: operation timed out,
  // P1017: server closed the connection.
  if (
    typeof code === "string" &&
    ["P1000", "P1001", "P1002", "P1003", "P1008", "P1017"].includes(code)
  ) {
    return true;
  }
  const name = "name" in err ? (err as { name?: unknown }).name : undefined;
  if (name === "PrismaClientInitializationError") return true;
  const message =
    "message" in err ? (err as { message?: unknown }).message : undefined;
  return (
    typeof message === "string" && /can't reach database server/i.test(message)
  );
}

// Safely parses a Request's JSON body, returning {} for an empty/absent
// body instead of throwing — so downstream zod validation produces a
// clean "field is required" error rather than a raw JSON-parse crash.
export async function readJsonBody(req: Request): Promise<unknown> {
  const text = await req.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ValidationError("Request body must be valid JSON");
  }
}
