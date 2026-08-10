const PIN_KEY = "personai.lock.pin.hash";
const ENABLED_KEY = "personai.lock.enabled";
const LOCKED_KEY = "personai.lock.locked";
const IDLE_MS_KEY = "personai.lock.idleMs";
const PASSKEY_KEY = "personai.lock.webauthn.enabled";
const CRED_ID_KEY = "personai.lock.webauthn.credId";
const USER_ID_KEY = "personai.lock.webauthn.userId";

/** Lightweight client PIN / passkey — never unwraps the password-sealed DB. */
async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function bytesToBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const bin = atob(padded + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function randomBytes(length: number): Uint8Array {
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  return buf;
}

function markUnlocked(): void {
  localStorage.removeItem(LOCKED_KEY);
  window.dispatchEvent(new CustomEvent("personai:app-lock", { detail: { locked: false } }));
}

/** WebAuthn needs a secure context (HTTPS / localhost). Soft-fail elsewhere. */
export function isSecureWebAuthnContext(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.isSecureContext && typeof PublicKeyCredential !== "undefined");
}

export async function canUsePlatformPasskey(): Promise<boolean> {
  if (!isSecureWebAuthnContext()) return false;
  const cred = globalThis.PublicKeyCredential;
  if (!cred || typeof cred.isUserVerifyingPlatformAuthenticatorAvailable !== "function") {
    return false;
  }
  try {
    return Boolean(await cred.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch {
    return false;
  }
}

export function isPinEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(ENABLED_KEY) === "1" && Boolean(localStorage.getItem(PIN_KEY));
}

export function isPasskeyEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(PASSKEY_KEY) === "1" && Boolean(localStorage.getItem(CRED_ID_KEY));
}

export function isLockEnabled(): boolean {
  return isPinEnabled() || isPasskeyEnabled();
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
  if (!isPasskeyEnabled()) localStorage.removeItem(LOCKED_KEY);
}

export async function registerPasskey(): Promise<void> {
  if (!isSecureWebAuthnContext()) {
    throw new Error("Passkeys need HTTPS (Tailscale Serve) or localhost.");
  }
  const available = await canUsePlatformPasskey();
  if (!available) {
    throw new Error("No platform authenticator (Face ID / fingerprint) on this device.");
  }

  let userIdRaw = localStorage.getItem(USER_ID_KEY);
  let userId: Uint8Array;
  if (userIdRaw) {
    userId = base64UrlToBytes(userIdRaw);
  } else {
    userId = randomBytes(16);
    userIdRaw = bytesToBase64Url(userId);
    localStorage.setItem(USER_ID_KEY, userIdRaw);
  }

  const hostname = window.location.hostname;
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32) as BufferSource,
      rp: { name: "PersonAI", id: hostname },
      user: {
        id: userId as BufferSource,
        name: `lock@${hostname}`,
        displayName: "PersonAI UI lock",
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred",
      },
      timeout: 60_000,
      attestation: "none",
    },
  });

  if (!credential || !(credential instanceof PublicKeyCredential)) {
    throw new Error("Passkey registration was cancelled.");
  }

  localStorage.setItem(CRED_ID_KEY, bytesToBase64Url(credential.rawId));
  localStorage.setItem(PASSKEY_KEY, "1");
}

export function clearPasskey(): void {
  localStorage.removeItem(CRED_ID_KEY);
  localStorage.removeItem(PASSKEY_KEY);
  localStorage.removeItem(USER_ID_KEY);
  if (!isPinEnabled()) localStorage.removeItem(LOCKED_KEY);
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
  if (!stored || localStorage.getItem(ENABLED_KEY) !== "1") return false;
  const hash = await sha256(`personai:${pin}`);
  if (hash !== stored) return false;
  markUnlocked();
  return true;
}

/**
 * Assert the registered platform passkey. Soft-fails when HTTPS / WebAuthn
 * is unavailable — never unlocks without a successful assertion.
 */
export async function tryBiometricUnlock(): Promise<boolean> {
  if (!isPasskeyEnabled() || !isSecureWebAuthnContext()) return false;
  const credId = localStorage.getItem(CRED_ID_KEY);
  if (!credId) return false;

  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32) as BufferSource,
        rpId: window.location.hostname,
        allowCredentials: [
          {
            id: base64UrlToBytes(credId) as BufferSource,
            type: "public-key",
            transports: ["internal"],
          },
        ],
        userVerification: "required",
        timeout: 60_000,
      },
    });
    if (!assertion || !(assertion instanceof PublicKeyCredential)) return false;
    markUnlocked();
    return true;
  } catch {
    return false;
  }
}
