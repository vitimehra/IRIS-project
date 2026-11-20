#!/usr/bin/env bash
# VITIS - one command to set up and run backend + frontend locally (macOS / Linux).
#   ./run.sh           start (real providers, needs keys in .env)
#   ./run.sh --mock    canned AI output and placeholder images - rehearsal only
#   ./run.sh --seed    (re)create the experimenter accounts from .env, then exit
#   ./run.sh --test    run the backend tests, then exit
set -euo pipefail
cd "$(dirname "$0")"
MOCK=0; SEED=0; TEST=0
for a in "$@"; do case "$a" in --mock) MOCK=1;; --seed) SEED=1;; --test) TEST=1;; *) echo "unknown option $a"; exit 1;; esac; done
step() { printf '\n\033[36m== %s\033[0m\n' "$1"; }

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env. Add ANTHROPIC_API_KEY, OPENAI_API_KEY, SECRET_SALT and the experimenter passwords, then run again."
  exit 1
fi
set -a; source .env; set +a

step "Python environment"
PY=python3; command -v python3 >/dev/null || PY=python
[[ -d .venv ]] || "$PY" -m venv .venv
PYV="$PWD/.venv/bin/python"
"$PYV" -m pip install -q --upgrade pip
"$PYV" -m pip install -q -r backend/requirements.txt

if [[ $TEST -eq 1 ]]; then step "Tests"; (cd backend && "$PYV" -m pytest tests -q); exit $?; fi
if [[ $SEED -eq 1 ]]; then step "Seeding"; (cd backend && "$PYV" -m app.seed); exit $?; fi

has=$(cd backend && "$PYV" -c "from app.db import SessionLocal; from app.models import Experimenter; from sqlalchemy import select; db=SessionLocal(); print(1 if db.scalar(select(Experimenter.id)) else 0)" 2>/dev/null || echo 0)
if [[ "$has" != "1" ]]; then step "No experimenter accounts yet - seeding from .env"; (cd backend && "$PYV" -m app.seed); fi

step "Frontend"
[[ -d frontend/node_modules ]] || (cd frontend && npm install --no-audit --no-fund)

BACKEND_PORT=${BACKEND_PORT:-8010}; FRONTEND_PORT=${FRONTEND_PORT:-5175}
[[ $MOCK -eq 1 ]] && export AI_PROVIDER=mock
step "Starting backend :$BACKEND_PORT and frontend :$FRONTEND_PORT $([[ $MOCK -eq 1 ]] && echo '[MOCK MODE]')"
(cd backend && "$PYV" -m uvicorn app.main:app --host 127.0.0.1 --port "$BACKEND_PORT") & BACK=$!
(cd frontend && npm run dev) & FRONT=$!
trap 'kill $BACK $FRONT 2>/dev/null || true' EXIT INT TERM
sleep 4
URL="http://localhost:$FRONTEND_PORT"
command -v open >/dev/null && open "$URL" || (command -v xdg-open >/dev/null && xdg-open "$URL" >/dev/null 2>&1 || true)
printf '\n\033[32mVITIS -> %s   console: /console   (Ctrl+C to stop)\033[0m\n' "$URL"
wait
