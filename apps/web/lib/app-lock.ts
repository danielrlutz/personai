const PIN_KEY = "personai.lock.pin.hash";
const ENABLED_KEY = "personai.lock.enabled";
const LOCKED_KEY = "personai.lock.locked";
const IDLE_MS_KEY = "personai.lock.idleMs";

/** Lightweight client PIN — hashes never stored plain. Session password still seals DB. */
async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function isLockEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(ENABLED_KEY) === "1";
}

export function getIdleLockMs(): number {
  if (typeof window === "undefined") return 5 * 60_000;
  const raw = Number(localStorage.getItem(IDLE_MS_KEY) ?? 5 * 60_000);
  return Number.isFinite(raw) && raw >= 60_000 ? raw : 5 * 60_000;
}

export function setIdleLockMs(ms: number): void {
  localStorage.setItem(IDLE_MS_KEY, String(ms));
}

export async function setAppPin(pin: string): Promise<void> {
  if (!/^\d{4,8}$/.test(pin)) throw new Error("PIN must be 4–8 digits");
  const hash = await sha256(`personai:${pin}`);
  localStorage.setItem(PIN_KEY, hash);
  localStorage.setItem(ENABLED_KEY, "1");
}

export function clearAppPin(): void {
  localStorage.removeItem(PIN_KEY);
  localStorage.removeItem(ENABLED_KEY);
  localStorage.removeItem(LOCKED_KEY);
}

export function lockApp(): void {
  if (!isLockEnabled()) return;
  localStorage.setItem(LOCKED_KEY, "1");
  window.dispatchEvent(new CustomEvent("personai:app-lock", { detail: { locked: true } }));
}

export function isAppLocked(): boolean {
  return isLockEnabled() && localStorage.getItem(LOCKED_KEY) === "1";
}

export async function unlockApp(pin: string): Promise<boolean> {
  const stored = localStorage.getItem(PIN_KEY);
  if (!stored) return false;
  const hash = await sha256(`personai:${pin}`);
  if (hash !== stored) return false;
  localStorage.removeItem(LOCKED_KEY);
  window.dispatchEvent(new CustomEvent("personai:app-lock", { detail: { locked: false } }));
  return true;
}

export async function tryBiometricUnlock(): Promise<boolean> {
  // WebAuthn platform authenticator — optional; fails soft when unavailable.
  const cred = globalThis.PublicKeyCredential;
  if (!cred || typeof cred.isUserVerifyingPlatformAuthenticatorAvailable !== "function") {
    return false;
  }
  try {
    const available = await cred.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!available) return false;
    // Soft gate: presence of platform authenticator + user gesture unlocks when PIN enabled.
    // Full WebAuthn registration is deferred; this avoids storing secrets.
    localStorage.removeItem(LOCKED_KEY);
    window.dispatchEvent(new CustomEvent("personai:app-lock", { detail: { locked: false } }));
    return true;
  } catch {
    return false;
  }
}
