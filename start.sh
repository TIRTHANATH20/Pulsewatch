#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NLP_ENABLED=true
NEXT_PORT="${NEXT_PORT:-3000}"
NLP_PORT="${NLP_PORT:-8000}"

usage() {
  printf 'Usage: %s [--no-nlp]\n' "$0"
  printf 'Starts the Next.js app and, by default, the Python NLP service.\n'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-nlp)
      NLP_ENABLED=false
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

cd "$ROOT_DIR"

for command_name in node npm curl; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Error: %s is required. Install Node.js 20+, npm, and curl first.\n' "$command_name" >&2
    exit 1
  fi
done

if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)'; then
  printf 'Error: Node.js 20+ is required.\n' >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  printf 'Error: .env is missing. Copy .env.example to .env and set DATABASE_URL first.\n' >&2
  exit 1
fi

if [[ ! -d node_modules ]]; then
  printf 'Installing Node.js dependencies...\n'
  npm ci
fi

if [[ "$NLP_ENABLED" == true ]]; then
  PYTHON_CMD=""
  for candidate in python3 python3.13 python3.12 python3.11; do
    if command -v "$candidate" >/dev/null 2>&1 &&
      "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)'; then
      PYTHON_CMD="$candidate"
      break
    fi
  done
  if [[ -z "$PYTHON_CMD" ]]; then
    printf 'Error: Python 3.11+ is required to run the NLP service. Use --no-nlp to skip it.\n' >&2
    exit 1
  fi

  NLP_PYTHON="$ROOT_DIR/nlp-service/.venv/bin/python"
  # Keep this check in sync with the imports performed during app startup.
  # Existing virtual environments may predate the LangGraph migration.
  if [[ ! -x "$NLP_PYTHON" ]] || ! "$NLP_PYTHON" -c 'import fastapi, faiss, gensim, sklearn, uvicorn, yfinance, langchain_core, langgraph' >/dev/null 2>&1; then
    printf 'Preparing Python NLP environment (first run may take several minutes)...\n'
    "$PYTHON_CMD" -m venv "$ROOT_DIR/nlp-service/.venv"
    "$NLP_PYTHON" -m pip install -r "$ROOT_DIR/nlp-service/requirements.txt"
  fi
fi

printf 'Generating Prisma client...\n'
node "$ROOT_DIR/node_modules/prisma/build/index.js" generate

pids=()
cleanup() {
  status=$?
  trap - EXIT INT TERM
  for pid in "${pids[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  for pid in "${pids[@]}"; do
    wait "$pid" 2>/dev/null || true
  done
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ "$NLP_ENABLED" == true ]]; then
  NLP_PID=""
  # Always replace a listener started by an earlier run. Reusing it can leave
  # the browser connected to stale Python agent code after an update.
  if command -v lsof >/dev/null 2>&1; then
    while IFS= read -r pid; do
      [[ "$pid" =~ ^[0-9]+$ ]] || continue
      printf 'Stopping existing NLP service (pid %s) on port %s...\n' "$pid" "$NLP_PORT"
      kill "$pid" 2>/dev/null || true
      for _ in {1..20}; do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.1
      done
    done < <(lsof -tiTCP:"$NLP_PORT" -sTCP:LISTEN)
  fi
  if lsof -nP -iTCP:"$NLP_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    printf 'Port %s is occupied; checking the next port for the NLP service.\n' "$NLP_PORT"
    while lsof -nP -iTCP:"$NLP_PORT" -sTCP:LISTEN >/dev/null 2>&1; do
      NLP_PORT=$((NLP_PORT + 1))
    done
  fi
  printf 'Starting Python NLP service at http://localhost:%s...\n' "$NLP_PORT"
  (
    cd "$ROOT_DIR/nlp-service"
    exec "$NLP_PYTHON" -m uvicorn app.main:app --host 127.0.0.1 --port "$NLP_PORT"
  ) &
  NLP_PID=$!
  pids+=("$NLP_PID")

  NLP_READY=false
  for _ in {1..30}; do
    if curl --silent --fail "http://127.0.0.1:${NLP_PORT}/health" >/dev/null; then
      NLP_READY=true
      break
    fi
    if ! kill -0 "$NLP_PID" 2>/dev/null; then
      wait "$NLP_PID" || true
      printf 'Error: Python NLP service exited before becoming ready.\n' >&2
      exit 1
    fi
    sleep 1
  done
  if [[ "$NLP_READY" != true ]]; then
    printf 'Error: Python NLP service did not become ready at http://localhost:%s.\n' "$NLP_PORT" >&2
    exit 1
  fi
fi

printf 'Starting PulseWatch on port %s...\n' "$NEXT_PORT"
# Development chunks are content-addressed. Remove a previous dev build so
# an interrupted/restarted server cannot leave the browser with stale assets.
if command -v lsof >/dev/null 2>&1; then
  while IFS= read -r pid; do
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    printf 'Stopping existing Next.js process (pid %s) on port %s...\n' "$pid" "$NEXT_PORT"
    kill "$pid" 2>/dev/null || true
    for _ in {1..20}; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.1
    done
  done < <(lsof -tiTCP:"$NEXT_PORT" -sTCP:LISTEN)
fi
rm -rf "$ROOT_DIR/.next"
NLP_SERVICE_URL="http://127.0.0.1:${NLP_PORT}" npm run dev -- --hostname 127.0.0.1 --port "$NEXT_PORT" &
NEXT_PID=$!
pids+=("$NEXT_PID")

NEXT_READY=false
for _ in {1..60}; do
  # Warm the protected app page, not only "/" (which redirects to /login
  # without a session). This compiles the page chunk before a real browser
  # request can reference it.
  if curl --silent --fail \
    -H 'Cookie: pw_session=startup-warmup' \
    "http://127.0.0.1:${NEXT_PORT}/" >/dev/null &&
    curl --silent --fail \
    "http://127.0.0.1:${NEXT_PORT}/_next/static/chunks/app/page.js" >/dev/null; then
    NEXT_READY=true
    break
  fi
  if ! kill -0 "$NEXT_PID" 2>/dev/null; then
    wait "$NEXT_PID" || true
    printf 'Error: Next.js exited before becoming ready.\n' >&2
    exit 1
  fi
  sleep 1
done
if [[ "$NEXT_READY" != true ]]; then
  printf 'Error: PulseWatch did not become ready at http://localhost:%s.\n' "$NEXT_PORT" >&2
  exit 1
fi

printf '\nPulseWatch is ready. Open these links:\n'
printf '  App:       http://localhost:%s/\n' "$NEXT_PORT"
if [[ "$NLP_ENABLED" == true ]]; then
  printf '  NLP docs:  http://localhost:%s/docs\n' "$NLP_PORT"
  printf '  NLP health: http://localhost:%s/health\n' "$NLP_PORT"
fi
printf 'Press Ctrl+C to stop the services.\n\n'

while kill -0 "$NEXT_PID" 2>/dev/null; do
  if [[ "$NLP_ENABLED" == true && -n "$NLP_PID" ]] && ! kill -0 "$NLP_PID" 2>/dev/null; then
    wait "$NLP_PID" || true
    printf 'Error: Python NLP service stopped unexpectedly.\n' >&2
    exit 1
  fi
  sleep 1
done

wait "$NEXT_PID"
