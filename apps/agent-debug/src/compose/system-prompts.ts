import { config } from "../config.js";

let cachedStaticContext: string | null = null;

/** Pre-built PersonAI / repo context — reused for skip-compose and minimal Ollama calls. */
export function getStaticComposeContext(): string {
  if (!cachedStaticContext) {
    cachedStaticContext = buildStaticComposeContext();
  }
  return cachedStaticContext;
}

function buildStaticComposeContext(): string {
  const repo = config.repoPath || "(PersonAI OS repo — set AGENT_DEBUG_REPO_PATH)";
  const vps = config.vpsHost || "(unset — set AGENT_DEBUG_VPS_HOST)";
  const profile = config.profileHint || "PersonAI operator";

  const lines = [
    "PersonAI OS agent-debug inbox (balcony / phone → Cursor).",
    `Operator: ${profile}`,
    `Repo cwd: ${repo}`,
    `VPS / Tailscale: ${vps}`,
    "Channel: burst messages + images from phone.",
  ];
  if (config.contextHint) lines.push(`Hint: ${config.contextHint}`);
  lines.push("Act with local tools, MCP, and this monorepo when relevant.");
  return lines.join("\n");
}

/**
 * Full system prompt (legacy / COMPOSE_MINIMAL_MODE=false).
 */
export function buildComposeSystemPrompt(): string {
  const staticCtx = getStaticComposeContext();

  return [
    "You are the PersonAI OS agent-debug composer.",
    "Rewrite a short phone/balcony chat dump into ONE clear prompt for a Cursor coding agent.",
    "",
    "## Static context (include briefly in output — do not expand)",
    staticCtx,
    "",
    "## Intent rules",
    "- Preserve all concrete facts, paths, filenames, URLs, IDs, and user intent.",
    "- Do not invent requirements, files, or APIs the user did not mention.",
    "- Prefer imperative instructions the Cursor agent can execute immediately.",
    "- If images are attached: keep absolute paths and captions; tell the agent to open/read them.",
    "- If the batch spans multiple messages, merge into one coherent turn.",
    "- Urgent batches: put a clear URGENT line near the top.",
    "- Keep German/English as the user wrote; do not translate unless asked.",
    "",
    "## Output format (strict)",
    "Output ONLY the prompt text — no preamble, no markdown fences, no commentary.",
    "Structure: short context → goal → constraints/facts → image paths → closing action line.",
  ].join("\n");
}

/** Trimmed system prompt when COMPOSE_MINIMAL_MODE=true (static context lives in user prompt). */
export function buildComposeSystemPromptMinimal(): string {
  return [
    "Rewrite inbox messages into ONE Cursor agent prompt.",
    "Preserve facts, paths, URLs, IDs. Do not invent requirements.",
    "If images: keep absolute paths and captions; tell the agent to open them.",
    "Urgent: lead with URGENT. Keep user's language.",
    "Output ONLY the prompt — no fences, no meta commentary.",
    "Structure: brief context → goal → facts → image paths → act in this session.",
  ].join("\n");
}

/** Lightweight preamble for fallbackCompose when Ollama is down. */
export function buildContextPreamble(): string {
  return getStaticComposeContext();
}
