/** Chrome/Edge `beforeinstallprompt` event (not in lib.dom yet everywhere). */
export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export type PwaInstallStatus =
  | "listening"
  | "installable"
  | "installed"
  | "unsupported"
  | "insecure"
  | "blocked";

export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  const mq = window.matchMedia?.("(display-mode: standalone)");
  if (mq?.matches) return true;
  // iOS Safari
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

export function isSecureInstallContext(): boolean {
  if (typeof window === "undefined") return false;
  if (window.isSecureContext) return true;
  // localhost is treated as a secure context by browsers
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

/**
 * Tailscale Serve HTTPS front door (sibling: HTTPS=1 vps-tailscale.sh).
 * Web:  https://HOST       → :3000
 * API:  https://HOST:8443  → :4000
 * Never suggest http://HOST:3000 for PWA install.
 */
export function suggestedHttpsWebUrl(): string | null {
  if (typeof window === "undefined") return null;
  if (window.location.protocol === "https:") return null;
  const { hostname, pathname, search, hash } = window.location;
  // Strip :3000 / other HTTP ports — Serve terminates TLS on 443.
  return `https://${hostname}${pathname}${search}${hash}`;
}

export function suggestedHttpsApiUrl(): string | null {
  if (typeof window === "undefined") return null;
  const { hostname } = window.location;
  if (!hostname || hostname === "localhost" || hostname === "127.0.0.1") return null;
  return `https://${hostname}:8443`;
}

export function httpsEnableCommand(): string | null {
  if (typeof window === "undefined") return null;
  const { hostname } = window.location;
  if (!hostname || hostname === "localhost" || hostname === "127.0.0.1") {
    return "HTTPS=1 ./scripts/vps-tailscale.sh <magicdns-host>";
  }
  return `HTTPS=1 ./scripts/vps-tailscale.sh ${hostname}`;
}
