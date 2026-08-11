import { getApiBaseUrl } from "./platform";

type ClientLogLevel = "info" | "warning" | "error";

let reporting = false;

/** Fire-and-forget client error reporting → API logs/error/ (no tokens in payload). */
export function reportClientLog(
  level: ClientLogLevel,
  message: string,
  context?: { stack?: string; component?: string },
): void {
  if (typeof window === "undefined" || reporting) return;
  reporting = true;
  const url = window.location.href.split("?")[0]?.slice(0, 500);
  void fetch(`${getApiBaseUrl()}/ops/client-log`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      level,
      message: message.slice(0, 2000),
      stack: context?.stack?.slice(0, 4000),
      url,
      component: context?.component,
    }),
    keepalive: true,
  }).catch(() => {
    // Swallow — never recurse on logging failure.
  }).finally(() => {
    reporting = false;
  });
}

export function reportClientError(err: unknown, component?: string): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  reportClientLog("error", message, { stack, component });
}

export function installGlobalClientErrorHandlers(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("error", (event) => {
    reportClientError(event.error ?? event.message, "window.onerror");
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportClientError(event.reason, "unhandledrejection");
  });
}
