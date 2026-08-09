#!/usr/bin/env bash
set -euo pipefail

HOST="${OLLAMA_HOST:-http://127.0.0.1:11434}"
VISION="${OLLAMA_VISION_MODEL:-maternion/LightOnOCR-2}"
REASONING="${OLLAMA_REASONING_MODEL:-deepseek-r1:8b}"

echo "Pulling models via ${HOST}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Prefer native CLI; only use compose ollama when the opt-in overlay service is up
if command -v ollama >/dev/null 2>&1; then
  ollama pull "$VISION"
  ollama pull "$REASONING"
elif command -v docker >/dev/null 2>&1 \
  && docker compose -f "$ROOT/docker-compose.yml" -f "$ROOT/docker-compose.ollama.yml" \
       ps --status running ollama 2>/dev/null | grep -q ollama; then
  docker compose -f "$ROOT/docker-compose.yml" -f "$ROOT/docker-compose.ollama.yml" \
    exec -T ollama ollama pull "$VISION"
  docker compose -f "$ROOT/docker-compose.yml" -f "$ROOT/docker-compose.ollama.yml" \
    exec -T ollama ollama pull "$REASONING"
else
  echo "No native ollama CLI and no running compose ollama service." >&2
  exit 1
fi

echo "Done."
