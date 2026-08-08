export type Platform = "browser" | "pwa" | "tauri";

const PROFILE_STORAGE_KEY = "personai:activeProfileId";
const API_URL_STORAGE_KEY = "personai:apiBaseUrl";

export function getPlatform(): Platform {
  if (typeof window === "undefined") return "browser";

  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

  if (isStandalone) return "pwa";

  const tauri = (window as Window & { __TAURI__?: unknown }).__TAURI__;
  if (tauri) return "tauri";

  return "browser";
}

export function isTauri(): boolean {
  return getPlatform() === "tauri";
}

export function getStoredProfileId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(PROFILE_STORAGE_KEY);
}

export function setStoredProfileId(profileId: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(PROFILE_STORAGE_KEY, profileId);
  window.dispatchEvent(new CustomEvent("personai:profile-changed", { detail: { profileId } }));
}

export function clearStoredProfileId(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(PROFILE_STORAGE_KEY);
  window.dispatchEvent(new CustomEvent("personai:profile-changed", { detail: { profileId: null } }));
}

export function getStoredApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(API_URL_STORAGE_KEY);
}

export function setStoredApiBaseUrl(url: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(API_URL_STORAGE_KEY, url.replace(/\/$/, ""));
}

export { PROFILE_STORAGE_KEY, API_URL_STORAGE_KEY };
