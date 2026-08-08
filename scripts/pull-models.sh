#!/usr/bin/env bash
set -euo pipefail

HOST="${OLLAMA_HOST:-http://127.0.0.1:11434}"
VISION="${OLLAMA_VISION_MODEL:-maternion/LightOnOCR-2}"
REASONING="${OLLAMA_REASONING_MODEL:-deepseek-r1:8b}"

echo "Pulling models via ${HOST}"

if command -v docker >/dev/null 2>&1 && docker compose ps ollama >/dev/null 2>&1; then
  docker compose exec -T ollama ollama pull "$VISION"
  docker compose exec -T ollama ollama pull "$REASONING"
else
  ollama pull "$VISION"
  ollama pull "$REASONING"
fi

echo "Done."
