$HostUrl = if ($env:OLLAMA_HOST) { $env:OLLAMA_HOST } else { "http://127.0.0.1:11434" }
$Vision = if ($env:OLLAMA_VISION_MODEL) { $env:OLLAMA_VISION_MODEL } else { "maternion/LightOnOCR-2" }
$Reasoning = if ($env:OLLAMA_REASONING_MODEL) { $env:OLLAMA_REASONING_MODEL } else { "deepseek-r1:8b" }

Write-Host "Pulling models via $HostUrl"

try {
  docker compose exec -T ollama ollama pull $Vision
  docker compose exec -T ollama ollama pull $Reasoning
} catch {
  ollama pull $Vision
  ollama pull $Reasoning
}

Write-Host "Done."
