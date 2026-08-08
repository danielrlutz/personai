import { apiPost, getProfileId, setProfileId } from "./api-client";
import { getStoredProfileId } from "./platform";

const PROFILES_PATH = "/profiles";
const HOME_PATH = "/dashboard";

/** Current client profile id (in-memory override or storage). */
export function getActiveProfileId(): string | null {
  return getProfileId() ?? getStoredProfileId();
}

/** Stored profile required for app shell; null means unauthenticated. */
export function requireProfile(): string | null {
  return getStoredProfileId();
}

/** Activate a profile: server switch + client session. */
export async function setActiveProfile(profileId: string): Promise<void> {
  await apiPost("/profiles/switch", { profileId });
  setProfileId(profileId);
}

/** Clear client session (storage + api-client override). */
export function clearSession(): void {
  setProfileId(null);
}

/**
 * Log out and hard-navigate to the profile gate.
 * Full navigation drops React page state so another profile's data cannot flash.
 */
export function logoutToProfiles(): void {
  clearSession();
  if (typeof window === "undefined") return;
  window.location.replace(PROFILES_PATH);
}

/** Select/create flow: activate profile then enter the app. */
export async function loginWithProfile(profileId: string): Promise<void> {
  await setActiveProfile(profileId);
  if (typeof window === "undefined") return;
  window.location.assign(HOME_PATH);
}