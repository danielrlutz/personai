export type Platform = "browser" | "pwa" | "tauri";

const PROFILE_STORAGE_KEY = "personai:activeProfileId";
const API_URL_STORAGE_KEY = "personai:apiBaseUrl";
const SESSION_TOKEN_KEY = "personai:sessionToken";

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

export function getStoredSessionToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(SESSION_TOKEN_KEY);
}

export function setStoredSessionToken(token: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(SESSION_TOKEN_KEY, token);
}

export function clearStoredSessionToken(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(SESSION_TOKEN_KEY);
}

/** Normalize API base: trim, drop trailing slash(es). Empty → null. */
export function normalizeApiBaseUrl(url: string): string | null {
  const trimmed = url.trim().replace(/\/+$/, "");
  return trimmed.length > 0 ? trimmed : null;
}

export function getStoredApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(API_URL_STORAGE_KEY);
  if (!raw) return null;
  const normalized = normalizeApiBaseUrl(raw);
  // Heal legacy values stored with a trailing slash
  if (normalized && normalized !== raw) {
    localStorage.setItem(API_URL_STORAGE_KEY, normalized);
  }
  return normalized;
}

export function setStoredApiBaseUrl(url: string): void {
  if (typeof window === "undefined") return;
  const normalized = normalizeApiBaseUrl(url);
  if (!normalized) {
    localStorage.removeItem(API_URL_STORAGE_KEY);
    return;
  }
  localStorage.setItem(API_URL_STORAGE_KEY, normalized);
}

export { PROFILE_STORAGE_KEY, API_URL_STORAGE_KEY, SESSION_TOKEN_KEY };
