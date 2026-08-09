import { config } from "../config.js";
import { hostHasModel, listInstalledModels } from "../ollama/client.js";
import { getSpecialist, modelNameForPref, type SpecialistModelPref } from "./roster.js";

export type ResolvedSpecialistModel = {
  model: string;
  pref: SpecialistModelPref;
  preferredModel: string;
  fallback: boolean;
};

/**
 * Pick Ollama model for a specialist.
 * Uses roster modelPref (coder vs reasoning); falls back to config.reasoningModel if preferred missing.
 */
export async function resolveSpecialistModel(
  host: string,
  specialistId: string,
): Promise<ResolvedSpecialistModel> {
  const specialist = getSpecialist(specialistId);
  const pref = specialist.modelPref;
  const preferredModel = modelNameForPref(pref);
  if (preferredModel === config.reasoningModel) {
    return { model: preferredModel, pref, preferredModel, fallback: false };
  }
  try {
    const installed = await listInstalledModels(host);
    if (hostHasModel(installed, preferredModel)) {
      return { model: preferredModel, pref, preferredModel, fallback: false };
    }
  } catch {
    // treat as missing → fallback
  }
  return {
    model: config.reasoningModel,
    pref,
    preferredModel,
    fallback: true,
  };
}
