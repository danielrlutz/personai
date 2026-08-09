const KEY = "personai.setup.completed";

export type SetupStepId =
  | "identity"
  | "ollama"
  | "google"
  | "taxonomy"
  | "notifications"
  | "done";

export function isSetupComplete(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(KEY) === "1";
}

export function markSetupComplete(): void {
  localStorage.setItem(KEY, "1");
}

export function resetSetup(): void {
  localStorage.removeItem(KEY);
}
