import { getStoredApiBaseUrl, normalizeApiBaseUrl } from "./platform";

export type FailureKind =
  | "network"
  | "timeout"
  | "auth"
  | "cors"
  | "server"
  | "ollama"
  | "unknown";

export type DescribedFailure = {
  message: string;
  sticky: boolean;
  kind: FailureKind;
};

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/** Best-effort API base for error copy (avoids importing api-client → cycle with toast). */
export function resolveApiBaseForErrors(explicit?: string): string {
  if (explicit?.trim()) return explicit.replace(/\/+$/, "");
  if (typeof window !== "undefined") {
    const stored = getStoredApiBaseUrl();
    if (stored) return stored;
  }
  const fromEnv = normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_URL ?? "");
  if (fromEnv) return fromEnv;
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host && !isLocalHostname(host)) {
      if (window.location.protocol === "https:") {
        return `https://${host}:8443`;
      }
      return `http://${host}:4000`;
    }
  }
  return "http://localhost:4000";
}

function isAbortError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const name = (err as { name?: unknown }).name;
  return name === "AbortError" || name === "TimeoutError";
}

function looksLikeNetworkFailure(message: string): boolean {
  return /failed to fetch|networkerror|load failed|fetch failed|network request failed|err_connection|econnrefused|enotfound|ehostunreach|net::/i.test(
    message,
  );
}

function looksLikeTimeout(message: string): boolean {
  return /timed?\s*out|timeout|aborted due to timeout|signal timed out/i.test(message);
}

function looksLikeCors(message: string): boolean {
  return /cors|cross-origin|access-control-allow-origin/i.test(message);
}

function looksLikeOllama(message: string): boolean {
  return /ollama|vram|no such model|model ['"]?[\w.:/-]+['"]? not found|waiting_for_vram|cuda out of memory|out of memory/i.test(
    message,
  );
}

/** True when an HTTPS page points at an http:// API (browser blocks → Failed to fetch). */
function isMixedContentApi(apiBase: string): boolean {
  if (typeof window === "undefined") return false;
  if (window.location.protocol !== "https:") return false;
  return /^http:\/\//i.test(apiBase);
}

/** Short scheme + unlock tip (never paste the long Serve script paragraph). */
const REACHABILITY_HINT =
  "Check API URL matches page scheme (http vs https). Unlock profile if health works but chat returns 401.";

const LEGACY_HINT_MARKERS =
  /tailscale serve status|--serve-only|Serve :8443|No serve config|vps-tailscale\.sh|Check API URL matches page scheme/i;

/**
 * streamSSE → outbox processor → queue each used to call describeApiFailure.
 * Prefix-only checks missed nested wraps where the outer message still matched
 * looksLikeNetworkFailure ("Failed to fetch" inside parens) and re-appended the hint.
 */
function alreadyDescribed(message: string): boolean {
  const m = message.trim();
  if (!m) return false;
  return (
    /Can['’]t reach API at |Mixed content:|Browser blocked the request to |Request timed out talking to API at /i.test(
      m,
    ) ||
    /Sign-in required|Not allowed \(403\)|^Server \d{3}:|^Ollama /i.test(m) ||
    LEGACY_HINT_MARKERS.test(m)
  );
}

function countOccurrences(haystack: string, pattern: RegExp): number {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return (haystack.match(new RegExp(pattern.source, flags)) ?? []).length;
}

/**
 * Collapse triple-wrapped reachability copy into one short line.
 * Exported for unit tests.
 */
export function collapseApiFailureMessage(message: string): string {
  const m = message.trim();
  if (!m) return m;

  const reachHits = countOccurrences(m, /Can['’]t reach API at /i);
  const hintHits = countOccurrences(m, LEGACY_HINT_MARKERS);
  const nestedOrLong =
    reachHits > 1 ||
    hintHits > 1 ||
    (reachHits >= 1 && hintHits >= 1 && m.length > 220);

  if (!nestedOrLong && !/^Can['’]t reach API at /i.test(m)) {
    return m;
  }

  if (!/Can['’]t reach API at /i.test(m) && !LEGACY_HINT_MARKERS.test(m)) {
    return m;
  }

  // First absolute API base (do not use \S+? — it collapses to a single "h").
  const reach = m.match(/Can['’]t reach API at (https?:\/\/[^\s)]+)/i);
  if (!reach) return m;

  const base = reach[1].replace(/[),.;]+$/, "");
  const path = m.match(/\((\/(?:team|ingest|career|api)[^)]*)\)/i)?.[1];
  const pathHint = path ? ` (${path})` : "";

  return `Can't reach API at ${base}${pathHint}. ${REACHABILITY_HINT}`;
}

function extractBodyMessage(body: unknown): string | null {
  if (typeof body === "string" && body.trim()) {
    const trimmed = body.trim();
    return trimmed.length > 280 ? `${trimmed.slice(0, 277)}…` : trimmed;
  }
  if (typeof body !== "object" || body === null) return null;
  const o = body as Record<string, unknown>;
  for (const key of ["message", "error", "detail", "title"]) {
    const v = o[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function formatOllamaMessage(raw: string): string {
  const text = raw.trim();
  if (/not found|pull|no such model/i.test(text)) {
    return `Ollama model missing — ${text}. Pull the model or change Settings → Ollama.`;
  }
  if (/vram|out of memory|insufficient|CUDA|GPU/i.test(text)) {
    return `Ollama VRAM / memory issue — ${text}`;
  }
  if (/ECONNREFUSED|connection refused|unreachable|fetch failed|ENOTFOUND/i.test(text)) {
    return `Ollama offline or unreachable — ${text}`;
  }
  if (/^Ollama /i.test(text) || looksLikeOllama(text)) {
    return text.startsWith("Ollama") ? text : `Ollama error — ${text}`;
  }
  return text;
}

function isApiErrorLike(
  err: unknown,
): err is { name: string; message: string; status: number; body?: unknown } {
  if (typeof err !== "object" || err === null) return false;
  const o = err as Record<string, unknown>;
  return (
    o.name === "ApiError" &&
    typeof o.message === "string" &&
    typeof o.status === "number"
  );
}

function kindFromDescribedMessage(message: string): FailureKind {
  if (/Mixed content:/i.test(message) || /Can['’]t reach API at /i.test(message)) return "network";
  if (/Browser blocked/i.test(message)) return "cors";
  if (/Request timed out/i.test(message)) return "timeout";
  if (/Sign-in required|Not allowed/i.test(message)) return "auth";
  if (/^Ollama /i.test(message)) return "ollama";
  if (/^Server \d{3}:/i.test(message)) return "server";
  return "unknown";
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "";
}

/**
 * Map fetch / ApiError / stream failures to human-readable copy.
 * Network failures always include the API base URL the client tried to call.
 * Idempotent: already-humanized / triple-wrapped messages collapse to one short line.
 */
export function describeApiFailure(
  err: unknown,
  options?: { apiBaseUrl?: string; path?: string },
): DescribedFailure {
  const base = resolveApiBaseForErrors(options?.apiBaseUrl);
  const pathHint = options?.path ? ` (${options.path})` : "";
  const incoming = errorMessage(err).trim();

  if (incoming && alreadyDescribed(incoming)) {
    return {
      kind: kindFromDescribedMessage(incoming),
      sticky: true,
      message: collapseApiFailureMessage(incoming),
    };
  }

  if (isAbortError(err) || (err instanceof Error && looksLikeTimeout(err.message))) {
    return {
      kind: "timeout",
      sticky: true,
      message: `Request timed out talking to API at ${base}${pathHint}. Check the API container and try again.`,
    };
  }

  if (isApiErrorLike(err)) {
    const status = err.status;
    const fromBody = extractBodyMessage(err.body);
    const raw = (fromBody ?? err.message).trim() || `Request failed (${status})`;

    if (alreadyDescribed(raw)) {
      return {
        kind: kindFromDescribedMessage(raw),
        sticky: true,
        message: collapseApiFailureMessage(raw),
      };
    }

    if (status === 401 || status === 403) {
      const code =
        typeof err.body === "object" &&
        err.body !== null &&
        "code" in err.body &&
        typeof (err.body as { code: unknown }).code === "string"
          ? String((err.body as { code: string }).code)
          : "";
      if (code === "AUTH_REQUIRED" || /authentication required|sign in/i.test(raw)) {
        return {
          kind: "auth",
          sticky: true,
          message: `Sign-in required (HTTP ${status}) talking to ${base}${pathHint} — unlock your profile, then retry.`,
        };
      }
      return {
        kind: "auth",
        sticky: true,
        message:
          status === 401
            ? `Sign-in required (401) at ${base}${pathHint} — unlock your profile, then retry.`
            : `Not allowed (403) at ${base}${pathHint} — ${raw}`,
      };
    }

    if (looksLikeOllama(raw) || status === 502 || status === 503) {
      return {
        kind: "ollama",
        sticky: true,
        message:
          status >= 500
            ? `Server ${status}: ${formatOllamaMessage(raw)}`
            : formatOllamaMessage(raw),
      };
    }

    if (status >= 500) {
      return {
        kind: "server",
        sticky: true,
        message: `Server ${status}: ${raw}`,
      };
    }

    return { kind: "server", sticky: status >= 400, message: raw };
  }

  if (err instanceof TypeError || (err instanceof Error && looksLikeNetworkFailure(err.message))) {
    const raw = err instanceof Error ? err.message : "Failed to fetch";
    if (looksLikeCors(raw)) {
      return {
        kind: "cors",
        sticky: true,
        message: `Browser blocked the request to ${base}${pathHint} (CORS). Use the Tailscale/LAN API URL and confirm the API is up.`,
      };
    }
    if (isMixedContentApi(base)) {
      return {
        kind: "network",
        sticky: true,
        message:
          `Mixed content: this page is HTTPS but Active API is ${base}${pathHint}. ` +
          `Use https://HOST:8443 via Tailscale Serve, or open http://HOST:3000 with API http://HOST:4000.`,
      };
    }
    return {
      kind: "network",
      sticky: true,
      message: collapseApiFailureMessage(
        `Can't reach API at ${base}${pathHint}. ${REACHABILITY_HINT}`,
      ),
    };
  }

  if (err instanceof Error) {
    const raw = err.message.trim() || "Something went wrong";

    if (looksLikeCors(raw)) {
      return {
        kind: "cors",
        sticky: true,
        message: `Browser blocked the request to ${base}${pathHint} (CORS). Check API CORS allowlist.`,
      };
    }

    if (looksLikeOllama(raw)) {
      return {
        kind: "ollama",
        sticky: true,
        message: formatOllamaMessage(raw),
      };
    }

    if (looksLikeTimeout(raw)) {
      return {
        kind: "timeout",
        sticky: true,
        message: `Request timed out talking to API at ${base}${pathHint}.`,
      };
    }

    return { kind: "unknown", sticky: false, message: raw };
  }

  return { kind: "unknown", sticky: false, message: "Something went wrong" };
}

/** Readable SSE `error` event payload → user-facing string. */
export function describeStreamError(data: unknown): string {
  if (typeof data === "string" && data.trim()) {
    return describeApiFailure(new Error(data.trim())).message;
  }
  if (typeof data !== "object" || data === null) {
    return "Chat stream error";
  }
  const o = data as Record<string, unknown>;
  const msg =
    (typeof o.message === "string" && o.message) ||
    (typeof o.error === "string" && o.error) ||
    null;
  if (msg) return describeApiFailure(new Error(msg)).message;
  return "Chat stream error";
}
