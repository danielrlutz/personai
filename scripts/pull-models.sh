#!/usr/bin/env bash
# Optional pulls — PersonAI defaults to models already on Daniel's host.
# Failover walks the catalog; do not require unknown tags.
set -euo pipefail

HOST="${OLLAMA_HOST:-http://127.0.0.1:11434}"
echo "Optional model pulls via ${HOST}"
echo "Defaults already assume these are present; only pull what is missing."

MODELS=(
  "maternion/LightOnOCR-2:latest"
  "deepseek-r1:8b"
  "deepseek-r1:14b"
  "qwen2.5-coder:14b-instruct-q5_K_M"
  "qwen2.5-coder:14b"
  "llama3.1:8b"
  "llama3:latest"
  "gemma4:e4b"
)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

pull_one() {
  local runner=("$@")
  local m
  for m in "${MODELS[@]}"; do
    echo "→ ${m}"
    "${runner[@]}" "$m" || echo "  (skip / already present / failed — catalog will failover)"
  done
}

if command -v ollama >/dev/null 2>&1; then
  pull_one ollama pull
elif command -v docker >/dev/null 2>&1 \
  && docker compose -f "$ROOT/docker-compose.yml" -f "$ROOT/docker-compose.ollama.yml" \
       ps --status running ollama 2>/dev/null | grep -q ollama; then
  pull_one docker compose -f "$ROOT/docker-compose.yml" -f "$ROOT/docker-compose.ollama.yml" \
    exec -T ollama ollama pull
else
  echo "No native ollama CLI and no running compose ollama service." >&2
  exit 1
fi

echo "Done. QA=deepseek-r1:8b · Forge=qwen2.5-coder:14b* · OCR=LightOnOCR-2"
