/**
 * Canonical Ollama model map for PersonAI.
 * Only tags Daniel already runs — never require unknown pulls (no qwen2.5-coder:7b, no flux).
 *
 * Failover walks each role's candidates against /api/tags, then deepseek-r1:8b.
 *
 * Model tiers:
 * - vision: first-pass OCR (LightOnOCR)
 * - reasoning: Staff/CFO/Legal chat (deepseek-r1:8b)
 * - architect: heavier design/spec (deepseek-r1:14b)
 * - reinspect: confirm "Flag for closer inspection" refine (prefer 14b over light 8b)
 */
export type ModelRole =
  | "vision"
  | "reasoning"
  | "architect"
  | "coder"
  | "coaching"
  | "stylist"
  | "qa"
  /** Closer inspection after user flags a confirm (neighbor OCR + structured refine). */
  | "reinspect";

/** Suggested pickers for Settings UI (order = preference). */
export const MODEL_ROLE_CANDIDATES: Record<ModelRole, readonly string[]> = {
  vision: ["maternion/LightOnOCR-2:latest", "maternion/LightOnOCR-2"],
  reasoning: ["deepseek-r1:8b"],
  architect: ["deepseek-r1:14b", "deepseek-r1:8b"],
  coder: [
    "qwen2.5-coder:14b-instruct-q5_K_M",
    "qwen2.5-coder:14b",
    "deepseek-r1:8b",
  ],
  coaching: ["llama3.1:8b", "llama3:latest", "deepseek-r1:8b"],
  stylist: ["gemma4:e4b", "llama3.1:8b", "deepseek-r1:8b"],
  /** QA: deepseek-r1 preferred (user); optional 14b for heavier review — not mistral. */
  qa: ["deepseek-r1:8b", "deepseek-r1:14b"],
  /** Reinspect refine pass: bump light → deepseek-r1:14b (failover 8b). */
  reinspect: ["deepseek-r1:14b", "deepseek-r1:8b"],
};

/** Defaults written to config / Settings vault when unset. */
export const MODEL_DEFAULTS = {
  visionModel: "maternion/LightOnOCR-2:latest",
  reasoningModel: "deepseek-r1:8b",
  architectModel: "deepseek-r1:14b",
  coderModel: "qwen2.5-coder:14b-instruct-q5_K_M",
  coachingModel: "llama3.1:8b",
  stylistModel: "gemma4:e4b",
  qaModel: "deepseek-r1:8b",
  /** Higher-grade refine for flagged confirms (defaults to architect-class 14b). */
  reinspectModel: "deepseek-r1:14b",
} as const;

/** Flat list for Settings suggestions + pull-models (optional). */
export const KNOWN_MODELS = [
  ...new Set([
    ...MODEL_ROLE_CANDIDATES.vision,
    ...MODEL_ROLE_CANDIDATES.reasoning,
    ...MODEL_ROLE_CANDIDATES.architect,
    ...MODEL_ROLE_CANDIDATES.coder,
    ...MODEL_ROLE_CANDIDATES.coaching,
    ...MODEL_ROLE_CANDIDATES.stylist,
    ...MODEL_ROLE_CANDIDATES.qa,
    ...MODEL_ROLE_CANDIDATES.reinspect,
  ]),
];

/** Never use for chat. */
export const BLOCKED_MODELS = ["flux2-klein", "flux"];

export function isBlockedModel(name: string): boolean {
  const lower = name.toLowerCase();
  return BLOCKED_MODELS.some((b) => lower.includes(b));
}

/**
 * Pick first installed candidate; prefer exact tag, then base name match.
 * Always ends at deepseek-r1:8b if nothing else matches.
 */
export function pickInstalledModel(
  installed: string[],
  candidates: readonly string[],
  ultimateFallback: string = MODEL_DEFAULTS.reasoningModel,
): { model: string; preferred: string; fallback: boolean } {
  const preferred = candidates[0] ?? ultimateFallback;
  const clean = installed.filter((n) => !isBlockedModel(n));
  for (const candidate of candidates) {
    const hit = matchInstalled(clean, candidate);
    if (hit) {
      return { model: hit, preferred, fallback: hit !== preferred && candidate !== preferred };
    }
  }
  const fb = matchInstalled(clean, ultimateFallback) ?? ultimateFallback;
  return { model: fb, preferred, fallback: true };
}

function matchInstalled(installed: string[], preferred: string): string | null {
  const pref = preferred.trim();
  if (!pref) return null;
  const exact = installed.find((n) => n === pref);
  if (exact) return exact;
  const prefBase = pref.split(":")[0]!;
  // prefer same base with any tag
  const tagged = installed.find((n) => n === prefBase || n.startsWith(`${prefBase}:`));
  return tagged ?? null;
}

export function roleForSpecialistId(specialistId: string): ModelRole {
  switch (specialistId) {
    case "architect":
      return "architect";
    case "forge":
      return "coder";
    case "qa_auditor":
      return "qa";
    case "stylist":
      return "stylist";
    case "bio_mechanic":
    case "mystic":
    case "wingman":
    case "career_strategist":
      return "coaching";
    case "secretary":
    case "cfo":
    case "legal_aide":
    case "medical_integrator":
    default:
      return "reasoning";
  }
}
