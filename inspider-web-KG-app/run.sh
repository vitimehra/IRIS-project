#!/usr/bin/env bash
# Inspider Web Visualizer - one command to build the data (if needed) and run both servers.
#
#   ./run.sh                build if missing, then start
#   ./run.sh --rebuild      rebuild the data from scratch, then start
#   ./run.sh --dev          use dev pseudo-embeddings (no API key; NOT meaningful)
#   ./run.sh --build-only   build the data and exit
#   ./run.sh --estimate     print token count and indicative cost, no API calls
#   ./run.sh --limit 2000   smoke test on a 2,000-verb sample
#
# Requires: Python 3.11+, Node 18+. macOS and Linux.
set -euo pipefail
cd "$(dirname "$0")"

REBUILD=0; DEV=0; BUILD_ONLY=0; ESTIMATE=0; LIMIT=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --rebuild) REBUILD=1 ;;
    --dev) DEV=1 ;;
    --build-only) BUILD_ONLY=1 ;;
    --estimate) ESTIMATE=1 ;;
    --limit) LIMIT="$2"; shift ;;
    *) echo "unknown option $1"; exit 1 ;;
  esac
  shift
done

step() { printf '\n\033[36m== %s\033[0m\n' "$1"; }

# --- .env ----------------------------------------------------------------------
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example. Add your OPENAI_API_KEY to it for real embeddings."
fi

# --- python ---------------------------------------------------------------------
step "Python environment"
PY=python3; command -v python3 >/dev/null || PY=python
[[ -d .venv ]] || "$PY" -m venv .venv
PYV=.venv/bin/python
"$PYV" -m pip install -q --upgrade pip
"$PYV" -m pip install -q -r requirements.txt

# --- data -----------------------------------------------------------------------
ARGS=()
[[ $DEV -eq 1 ]] && ARGS+=(--provider dev)
[[ $LIMIT -gt 0 ]] && ARGS+=(--limit "$LIMIT")

if [[ $ESTIMATE -eq 1 ]]; then
  step "Cost estimate"
  [[ -f data/verbs_glossed.parquet ]] || { "$PYV" -m pipeline.build --only 01; "$PYV" -m pipeline.build --only 02; }
  "$PYV" -m pipeline.build --estimate
  exit 0
fi

if [[ $REBUILD -eq 1 || ! -f data/nodes.parquet ]]; then
  step "Building the web (downloads the verb sources on first run)"
  if [[ $DEV -eq 0 ]] && ! grep -Eq '^\s*OPENAI_API_KEY\s*=\s*\S' .env; then
    echo "No OPENAI_API_KEY in .env. Either add one, or run with --dev for a smoke test." >&2
    exit 1
  fi
  [[ $REBUILD -eq 1 ]] && ARGS+=(--force)
  "$PYV" -m pipeline.build "${ARGS[@]}"
else
  echo "Data present in data/ - skipping build (use --rebuild to redo)."
fi
[[ $BUILD_ONLY -eq 1 ]] && exit 0

# --- frontend deps ---------------------------------------------------------------
step "Frontend"
[[ -d frontend/node_modules ]] || (cd frontend && npm install --no-audit --no-fund)

# --- ports ------------------------------------------------------------------------
BACKEND_PORT=$(grep -E '^\s*BACKEND_PORT\s*=' .env | sed 's/.*=\s*//' | tr -d '[:space:]'); BACKEND_PORT=${BACKEND_PORT:-8000}
FRONTEND_PORT=$(grep -E '^\s*FRONTEND_PORT\s*=' .env | sed 's/.*=\s*//' | tr -d '[:space:]'); FRONTEND_PORT=${FRONTEND_PORT:-5174}

# --- servers ------------------------------------------------------------------------
step "Starting backend on :$BACKEND_PORT and frontend on :$FRONTEND_PORT"
"$PYV" -m uvicorn backend.app:app --host 127.0.0.1 --port "$BACKEND_PORT" &
BACK=$!
(cd frontend && npm run dev) &
FRONT=$!
trap 'kill $BACK $FRONT 2>/dev/null || true' EXIT INT TERM

sleep 3
URL="http://localhost:$FRONTEND_PORT"
if command -v open >/dev/null; then open "$URL"; elif command -v xdg-open >/dev/null; then xdg-open "$URL" >/dev/null 2>&1 || true; fi
printf '\n\033[32mInspider Web Visualizer -> %s   (Ctrl+C to stop both)\033[0m\n' "$URL"
wait
