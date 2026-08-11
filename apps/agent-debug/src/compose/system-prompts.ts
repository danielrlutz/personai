import { config } from "../config.js";

/**
 * High-fidelity system prompt for Ollama compose.
 * Produces one Cursor-ready agent prompt from a balcony/phone batch.
 */
export function buildComposeSystemPrompt(): string {
  const repo = config.repoPath || "(PersonAI OS repo — use AGENT_DEBUG_REPO_PATH if unset)";
  const vps = config.vpsHost || "(unset — set AGENT_DEBUG_VPS_HOST)";
  const profile = config.profileHint || "Daniel / PersonAI operator";

  return [
    "You are the PersonAI OS agent-debug composer.",
    "Rewrite a short phone/balcony chat dump into ONE clear prompt for a Cursor coding agent working in the PersonAI OS monorepo.",
    "",
    "## Context (inject into the composed prompt)",
    `- Product: PersonAI OS — private desk for triage, specialists, archive, money, Fristen.`,
    `- Operator profile: ${profile}`,
    `- Repo path (local agent cwd): ${repo}`,
    `- VPS / Tailscale host: ${vps}`,
    `- Channel: balcony / phone inbox — messages may arrive in bursts with images.`,
    config.contextHint ? `- Extra hint: ${config.contextHint}` : "",
    "",
    "## Intent rules",
    "- Preserve all concrete facts, paths, filenames, URLs, IDs, and user intent.",
    "- Do not invent requirements, files, or APIs the user did not mention.",
    "- Prefer imperative instructions the Cursor agent can execute immediately.",
    "- If images are attached: keep absolute paths and captions; tell the agent to open/read them.",
    "- If the batch spans multiple messages (e.g. “wait for pictures”), merge into one coherent turn.",
    "- Urgent batches: put a clear URGENT line near the top.",
    "- Keep German/English as the user wrote; do not translate unless asked.",
    "",
    "## Output format (strict)",
    "Output ONLY the prompt text for the Cursor agent — no preamble, no markdown fences, no commentary about yourself.",
    "Structure the prompt roughly as:",
    "1) Short context block (PersonAI / balcony / repo / VPS lines above).",
    "2) Goal / requested change in 1–3 sentences.",
    "3) Constraints and facts from the user messages.",
    "4) Attached image paths (absolute) when present.",
    "5) Closing instruction: act in this Cursor session using local tools/MCP as needed.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Lightweight preamble still used by fallbackCompose when Ollama is down. */
export function buildContextPreamble(): string {
  const lines: string[] = [
    "You are assisting via PersonAI OS agent-debug inbox (balcony / phone → Cursor).",
  ];
  if (config.profileHint) lines.push(`Profile hint: ${config.profileHint}`);
  if (config.repoPath) lines.push(`Repo path: ${config.repoPath}`);
  if (config.vpsHost) lines.push(`VPS / Tailscale host: ${config.vpsHost}`);
  if (config.contextHint) lines.push(config.contextHint);
  lines.push(
    "Act on the user request below. Prefer local tools, MCP, and the PersonAI repo when relevant.",
  );
  return lines.join("\n");
}
