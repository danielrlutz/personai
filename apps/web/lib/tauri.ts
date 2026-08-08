import { setApiBaseUrl } from "./api-client";

type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

function getInvoke(): TauriInvoke | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    __TAURI__?: { core?: { invoke?: TauriInvoke } };
    __TAURI_INTERNALS__?: { invoke?: TauriInvoke };
  };
  return w.__TAURI__?.core?.invoke ?? w.__TAURI_INTERNALS__?.invoke ?? null;
}

export function isTauriRuntime(): boolean {
  return getInvoke() != null;
}

/** Sync desktop API base URL from the Rust sidecar (dynamic port). */
export async function syncTauriApiBaseUrl(): Promise<string | null> {
  const invoke = getInvoke();
  if (!invoke) return null;
  try {
    const base = await invoke("get_api_base_url");
    if (typeof base === "string" && base.length > 0) {
      setApiBaseUrl(base);
      return base;
    }
  } catch {
    /* not running inside Tauri, or command unavailable */
  }
  return null;
}
