# Optional pulls — defaults assume Daniel's host already has these tags.
$Models = @(
  "maternion/LightOnOCR-2:latest",
  "deepseek-r1:8b",
  "deepseek-r1:14b",
  "qwen2.5-coder:14b-instruct-q5_K_M",
  "qwen2.5-coder:14b",
  "llama3.1:8b",
  "llama3:latest",
  "gemma4:e4b"
)

Write-Host "Optional model pulls (failover if missing)"
foreach ($m in $Models) {
  Write-Host "→ $m"
  try {
    ollama pull $m
  } catch {
    try {
      docker compose exec -T ollama ollama pull $m
    } catch {
      Write-Host "  skip: $_"
    }
  }
}
Write-Host "Done. QA=deepseek-r1:8b · Forge=qwen2.5-coder:14b* · OCR=LightOnOCR-2"
