import {
  apiPost,
  getProfileId,
  getSessionToken,
  setProfileId,
  setSessionToken,
  type AuthResponse,
  type Profile,
} from "./api-client";
import { getStoredProfileId, getStoredSessionToken } from "./platform";

/** Trailing slashes match next.config trailingSlash + static export dirs. */
const PROFILES_PATH = "/profiles/";
const HOME_PATH = "/dashboard/";

/** Current client profile id (in-memory override or storage). */
export function getActiveProfileId(): string | null {
  return getProfileId() ?? getStoredProfileId();
}

/** Stored profile + session token required for app shell. */
export function requireProfile(): string | null {
  const profileId = getStoredProfileId();
  const token = getStoredSessionToken();
  if (!profileId || !token) return null;
  return profileId;
}

export function requireSession(): { profileId: string; token: string } | null {
  const profileId = getStoredProfileId();
  const token = getStoredSessionToken();
  if (!profileId || !token) return null;
  return { profileId, token };
}

function applyAuth(auth: AuthResponse): void {
  setSessionToken(auth.token);
  setProfileId(auth.profile.id);
}

/** Activate a profile after a successful password login (server already unlocked). */
export async function setActiveProfile(profileId: string): Promise<void> {
  await apiPost("/profiles/switch", { profileId });
  setProfileId(profileId);
}

/** Clear client session (storage + api-client override). */
export function clearSession(): void {
  setSessionToken(null);
  setProfileId(null);
}

/**
 * Log out and hard-navigate to the profile gate.
 * Full navigation drops React page state so another profile's data cannot flash.
 */
export function logoutToProfiles(): void {
  const token = getSessionToken();
  if (token) {
    void apiPost("/auth/logout", undefined, { silent: true }).catch(() => undefined);
  }
  // Security: wipe offline outbox blobs/ops on logout so queued payloads don't linger.
  if (typeof window !== "undefined") {
    void import("./outbox")
      .then(({ getOutbox }) => getOutbox().clearAll?.())
      .catch(() => undefined);
    try {
      localStorage.removeItem("personai.lock.locked");
    } catch {
      /* ignore */
    }
  }
  clearSession();
  if (typeof window === "undefined") return;
  window.location.replace(PROFILES_PATH);
}

/** Password login → session token → enter the app. */
export async function loginWithPassword(profileId: string, password: string): Promise<void> {
  const auth = await apiPost<AuthResponse>("/auth/login", { profileId, password }, { silent: true });
  applyAuth(auth);
  if (typeof window === "undefined") return;
  window.location.assign(HOME_PATH);
}

/** First-run / migration: set password then enter the app. */
export async function setupPassword(profileId: string, password: string): Promise<void> {
  const auth = await apiPost<AuthResponse>("/auth/setup", { profileId, password }, { silent: true });
  applyAuth(auth);
  if (typeof window === "undefined") return;
  window.location.assign(HOME_PATH);
}

/** Create profile with password (server returns session). */
export async function createProfileWithPassword(
  name: string,
  password: string,
): Promise<Profile> {
  const auth = await apiPost<AuthResponse>("/profiles", { name, password }, { silent: true });
  applyAuth(auth);
  return auth.profile;
}

/** Select/create flow after auth already applied: enter the app. */
export async function enterApp(): Promise<void> {
  if (typeof window === "undefined") return;
  window.location.assign(HOME_PATH);
}

/** @deprecated Use loginWithPassword — bare profile id is no longer a credential. */
export async function loginWithProfile(profileId: string): Promise<void> {
  await setActiveProfile(profileId);
  if (typeof window === "undefined") return;
  window.location.assign(HOME_PATH);
}
