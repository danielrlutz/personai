/** Global toast/snackbar store — usable outside React (API client, outbox). */

export type ToastType = "error" | "success" | "info" | "warning";

export interface ToastItem {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  /** When true, stays until the user dismisses. */
  sticky: boolean;
  durationMs: number;
  createdAt: number;
}

export type ToastInput = {
  type?: ToastType;
  title?: string;
  message: string;
  sticky?: boolean;
  durationMs?: number;
  /** Deduplicate key — same key replaces / skips spam within a short window. */
  dedupeKey?: string;
};

type Listener = (toasts: ToastItem[]) => void;

const DEFAULT_DURATION: Record<ToastType, number> = {
  error: 7000,
  success: 4000,
  info: 5000,
  warning: 6000,
};

const MAX_TOASTS = 5;
const DEDUPE_MS = 2500;

let toasts: ToastItem[] = [];
const listeners = new Set<Listener>();
const recentKeys = new Map<string, number>();

function emit(): void {
  const snapshot = toasts.slice();
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch {
      // listeners must not break the store
    }
  }
}

function newId(): string {
  return `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function shouldDedupe(key: string): boolean {
  const now = Date.now();
  for (const [k, at] of recentKeys) {
    if (now - at > DEDUPE_MS) recentKeys.delete(k);
  }
  const prev = recentKeys.get(key);
  if (prev !== undefined && now - prev < DEDUPE_MS) return true;
  recentKeys.set(key, now);
  return false;
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener(toasts.slice());
  return () => {
    listeners.delete(listener);
  };
}

export function getToasts(): ToastItem[] {
  return toasts.slice();
}

export function dismissToast(id: string): void {
  const next = toasts.filter((t) => t.id !== id);
  if (next.length === toasts.length) return;
  toasts = next;
  emit();
}

export function dismissAllToasts(): void {
  if (toasts.length === 0) return;
  toasts = [];
  emit();
}

export function pushToast(input: ToastInput): string | null {
  if (typeof window === "undefined") return null;

  const type = input.type ?? "info";
  const message = input.message.trim();
  if (!message) return null;

  const dedupeKey = input.dedupeKey ?? `${type}:${input.title ?? ""}:${message}`;
  if (shouldDedupe(dedupeKey)) return null;

  const sticky = input.sticky ?? false;
  const item: ToastItem = {
    id: newId(),
    type,
    title: input.title?.trim() || undefined,
    message,
    sticky,
    durationMs: input.durationMs ?? DEFAULT_DURATION[type],
    createdAt: Date.now(),
  };

  toasts = [...toasts, item].slice(-MAX_TOASTS);
  emit();
  return item.id;
}

function makeHelper(type: ToastType) {
  return (
    message: string,
    options?: Omit<ToastInput, "type" | "message">,
  ): string | null => pushToast({ ...options, type, message });
}

export const toast = {
  push: pushToast,
  dismiss: dismissToast,
  dismissAll: dismissAllToasts,
  error: makeHelper("error"),
  success: makeHelper("success"),
  info: makeHelper("info"),
  warning: makeHelper("warning"),
};

function isApiErrorLike(
  err: unknown,
): err is { name: string; message: string; status: number } {
  if (typeof err !== "object" || err === null) return false;
  const o = err as Record<string, unknown>;
  return (
    o.name === "ApiError" &&
    typeof o.message === "string" &&
    typeof o.status === "number"
  );
}

/** Readable snackbar copy for fetch / ApiError failures. */
export function notifyApiFailure(err: unknown, options?: { sticky?: boolean; title?: string }): void {
  const { message, sticky } = describeApiFailure(err);
  toast.error(message, {
    title: options?.title ?? "Request failed",
    sticky: options?.sticky ?? sticky,
    dedupeKey: `api:${message}`,
  });
}

export function describeApiFailure(err: unknown): { message: string; sticky: boolean } {
  if (err instanceof TypeError) {
    return {
      message: "Couldn't reach the API (Failed to fetch). Check connection and Settings → API URL.",
      sticky: true,
    };
  }

  if (isApiErrorLike(err)) {
    const status = err.status;
    const base = err.message.trim() || `Request failed (${status})`;
    if (status >= 500 || status === 401 || status === 403) {
      return { message: base, sticky: true };
    }
    return { message: base, sticky: false };
  }

  if (err instanceof Error) {
    if (/failed to fetch|networkerror|load failed|fetch failed/i.test(err.message)) {
      return {
        message: "Couldn't reach the API (Failed to fetch). Check connection and Settings → API URL.",
        sticky: true,
      };
    }
    return { message: err.message || "Something went wrong", sticky: false };
  }

  return { message: "Something went wrong", sticky: false };
}
