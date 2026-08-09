$HostUrl = if ($env:OLLAMA_HOST) { $env:OLLAMA_HOST } else { "http://127.0.0.1:11434" }
$Vision = if ($env:OLLAMA_VISION_MODEL) { $env:OLLAMA_VISION_MODEL } else { "maternion/LightOnOCR-2" }
$Reasoning = if ($env:OLLAMA_REASONING_MODEL) { $env:OLLAMA_REASONING_MODEL } else { "deepseek-r1:8b" }
$Coder = if ($env:OLLAMA_CODER_MODEL) { $env:OLLAMA_CODER_MODEL } else { "qwen2.5-coder:7b" }

Write-Host "Pulling models via $HostUrl"
Write-Host "  vision:    $Vision"
Write-Host "  reasoning: $Reasoning"
Write-Host "  coder:     $Coder (Forge; optional — falls back to reasoning)"

try {
  docker compose exec -T ollama ollama pull $Vision
  docker compose exec -T ollama ollama pull $Reasoning
  docker compose exec -T ollama ollama pull $Coder
} catch {
  ollama pull $Vision
  ollama pull $Reasoning
  ollama pull $Coder
}

Write-Host "Done."
