import { listInstalledModels } from "../ollama/client.js";
import { resolveProductConfig } from "../settings/host-vault.js";
import {
  MODEL_DEFAULTS,
  MODEL_ROLE_CANDIDATES,
  pickInstalledModel,
  roleForSpecialistId,
  type ModelRole,
} from "./model-catalog.js";

export type ResolvedSpecialistModel = {
  model: string;
  role: ModelRole;
  preferredModel: string;
  fallback: boolean;
  /** @deprecated use role — kept for older clients */
  pref: "reasoning" | "coder" | "coaching" | "architect" | "qa" | "stylist";
};

function configuredCandidates(role: ModelRole): string[] {
  const product = resolveProductConfig();
  const primary =
    role === "vision"
      ? product.visionModel
      : role === "architect"
        ? product.architectModel ?? MODEL_DEFAULTS.architectModel
        : role === "reinspect"
          ? // Closer inspection: vault reinspectModel (14b) before light reasoning.
            product.reinspectModel ??
            product.architectModel ??
            MODEL_DEFAULTS.reinspectModel
          : role === "coder"
            ? product.coderModel
            : role === "coaching"
              ? product.coachingModel ?? MODEL_DEFAULTS.coachingModel
              : role === "stylist"
                ? product.stylistModel ?? MODEL_DEFAULTS.stylistModel
                : role === "qa"
                  ? product.qaModel ?? MODEL_DEFAULTS.qaModel
                  : product.reasoningModel;

  const catalog = MODEL_ROLE_CANDIDATES[role];
  const ordered = [primary, ...catalog.filter((c) => c !== primary)];
  return ordered;
}

/**
 * Pick Ollama model for a specialist from the known catalog.
 * Never demands missing tags like qwen2.5-coder:7b — fails over within pulled list.
 */
export async function resolveSpecialistModel(
  host: string,
  specialistId: string,
): Promise<ResolvedSpecialistModel> {
  const role = roleForSpecialistId(specialistId);
  const candidates = configuredCandidates(role);
  const preferredModel = candidates[0] ?? MODEL_DEFAULTS.reasoningModel;

  let installed: string[] = [];
  try {
    installed = await listInstalledModels(host);
  } catch {
    installed = [];
  }

  const picked = pickInstalledModel(installed, candidates, MODEL_DEFAULTS.reasoningModel);
  return {
    model: picked.model,
    role,
    preferredModel,
    fallback: picked.fallback || picked.model !== preferredModel,
    pref: role === "coder" ? "coder" : role === "coaching" ? "coaching" : role === "architect" ? "architect" : role === "qa" ? "qa" : role === "stylist" ? "stylist" : "reasoning",
  };
}

async function resolveRoleModel(
  host: string,
  role: ModelRole,
  pref: ResolvedSpecialistModel["pref"] = "reasoning",
): Promise<ResolvedSpecialistModel> {
  const candidates = configuredCandidates(role);
  const preferredModel = candidates[0]!;
  let installed: string[] = [];
  try {
    installed = await listInstalledModels(host);
  } catch {
    installed = [];
  }
  const ultimate =
    role === "reinspect" || role === "architect"
      ? MODEL_DEFAULTS.reinspectModel
      : MODEL_DEFAULTS.reasoningModel;
  const picked = pickInstalledModel(installed, candidates, ultimate);
  return {
    model: picked.model,
    role,
    preferredModel,
    fallback: picked.fallback || picked.model !== preferredModel,
    pref,
  };
}

/** Resolve vision OCR model from catalog. */
export async function resolveVisionModel(host: string): Promise<ResolvedSpecialistModel> {
  return resolveRoleModel(host, "vision", "reasoning");
}

/**
 * Resolve closer-inspection refine model (Settings → Reinspect tier).
 * Prefer deepseek-r1:14b over light 8b; OCR itself still uses resolveVisionModel.
 */
export async function resolveReinspectModel(host: string): Promise<ResolvedSpecialistModel> {
  return resolveRoleModel(host, "reinspect", "architect");
}
