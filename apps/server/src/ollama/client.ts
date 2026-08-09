import fs from "node:fs";
import { config } from "../config.js";

export type OllamaSlot = "VISION" | "REASONING";

/** How Ollama appears relative to this API process. */
export type OllamaRuntime = "native" | "docker" | "remote" | "unknown";

export type OllamaCandidateStatus = {
  host: string;
  up: boolean;
  runtime: OllamaRuntime;
};

const NATIVE_LOOPBACK = ["http://127.0.0.1:11434", "http://localhost:11434"] as const;
const HOST_DOCKER_INTERNAL = "http://host.docker.internal:11434";
const COMPOSE_OLLAMA = "http://ollama:11434";
const HOST_CACHE_TTL_MS = 10_000;
const PROBE_TIMEOUT_MS = 1500;

let hostOverride: string | null = null;
let lastKnownGood: string | null = null;
let cachedHost: string | null = null;
let cachedAt = 0;
let resolveInFlight: Promise<string> | null = null;

export function modelForSlot(slot: OllamaSlot): string {
  return slot === "VISION" ? config.visionModel : config.reasoningModel;
}

export function getConfiguredOllamaHost(): string {
  return (hostOverride ?? config.ollamaHost).replace(/\/$/, "");
}

/** Runtime override (settings UI). Does not rewrite process.env permanently. */
export function setOllamaHostOverride(host: string): void {
  hostOverride = host.trim().replace(/\/$/, "");
  invalidateOllamaHostCache();
}

export function invalidateOllamaHostCache(): void {
  cachedHost = null;
  cachedAt = 0;
}

export function getLastKnownGoodOllamaHost(): string | null {
  return lastKnownGood;
}

export function isApiInDocker(): boolean {
  try {
    if (fs.existsSync("/.dockerenv")) return true;
  } catch {
    // ignore
  }
  // Common compose / k8s markers
  if (process.env.PERSONAI_IN_DOCKER === "1" || process.env.PERSONAI_IN_DOCKER === "true") {
    return true;
  }
  return false;
}

export function classifyOllamaRuntime(host: string): OllamaRuntime {
  try {
    const hostname = new URL(host).hostname.toLowerCase();
    if (hostname === "host.docker.internal") return "native";
    if (hostname === "ollama" || hostname.startsWith("ollama.")) return "docker";
    if (hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1") {
      return "native";
    }
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname)) {
      return "remote";
    }
    // Bare Docker/Compose service hostnames have no dots
    if (!hostname.includes(".")) return "docker";
    return "remote";
  } catch {
    return "unknown";
  }
}

function normalizeHost(host: string): string {
  return host.replace(/\/$/, "");
}

function markHostHealthy(host: string): void {
  const normalized = normalizeHost(host);
  cachedHost = normalized;
  cachedAt = Date.now();
  lastKnownGood = normalized;
}

/** Ordered failover candidates (deduped). */
export function buildProbeCandidates(): string[] {
  const configured = getConfiguredOllamaHost();
  const inDocker = isApiInDocker();
  const candidates: string[] = [];

  const push = (host: string | undefined | null) => {
    if (!host) return;
    const normalized = normalizeHost(host);
    if (!candidates.includes(normalized)) candidates.push(normalized);
  };

  // 1) Configured OLLAMA_HOST / settings override
  push(configured);
  // 2) Last known healthy host
  push(lastKnownGood);
  // 3–4) Native loopback
  for (const native of NATIVE_LOOPBACK) push(native);
  // 5) Host gateway (Docker Desktop / compose → native Ollama)
  push(HOST_DOCKER_INTERNAL);
  // 6) Compose service name when API is in Docker
  if (inDocker) push(COMPOSE_OLLAMA);

  return candidates;
}

export async function probeOllamaHost(host: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  try {
    const res = await fetch(`${normalizeHost(host)}/api/tags`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Human-readable Ollama HTTP failures for SSE / API clients. */
export function formatOllamaHttpError(
  kind: "chat" | "stream" | "vision",
  status: number,
  bodyText: string,
  host: string,
  model: string,
): string {
  const snippet = bodyText.trim().replace(/\s+/g, " ").slice(0, 240);
  const lower = snippet.toLowerCase();
  if (status === 404 || /not found|no such model|model .+ does not exist/i.test(snippet)) {
    return `Ollama model missing: "${model}" on ${host}. Pull it (ollama pull ${model}) or change the reasoning/vision model in settings.`;
  }
  if (/out of memory|vram|cuda|insufficient memory|requires more/i.test(lower)) {
    return `Ollama VRAM/memory exhausted for "${model}" on ${host}. Unload other models or use a smaller model. ${snippet}`;
  }
  if (!status || status === 0) {
    return `Ollama offline or unreachable at ${host} (${kind}). Is Ollama running?`;
  }
  return `Ollama ${kind} failed (${status}) for "${model}" at ${host}: ${snippet || "no details"}`;
}

/** Map connection / runtime errors to readable chat failures. */
export function humanizeOllamaError(err: unknown, host?: string, model?: string): string {
  const hostLabel = host ? ` at ${host}` : "";
  const modelLabel = model ? ` (model ${model})` : "";
  if (err instanceof Error) {
    const msg = err.message;
    if (/^Ollama /i.test(msg)) return msg;
    if (isConnectionError(err) || /fetch failed|econnrefused/i.test(msg)) {
      return `Ollama offline or unreachable${hostLabel}${modelLabel}. Start Ollama on the host or fix OLLAMA_HOST.`;
    }
    if (/timed?\s*out|timeout|aborterror/i.test(msg)) {
      return `Ollama timed out${hostLabel}${modelLabel}. The model may be loading or overloaded.`;
    }
    if (/vram|out of memory|cuda/i.test(msg)) {
      return `Ollama VRAM/memory issue${modelLabel}: ${msg}`;
    }
    return msg;
  }
  return String(err);
}

function isConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  if (
    msg.includes("fetch failed") ||
    msg.includes("network") ||
    msg.includes("socket") ||
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("enotfound") ||
    msg.includes("etimedout") ||
    msg.includes("ehostunreach") ||
    msg.includes("other side closed")
  ) {
    return true;
  }
  const cause = (err as { cause?: { code?: string; message?: string } }).cause;
  const code = cause?.code?.toUpperCase();
  if (
    code &&
    ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "EHOSTUNREACH", "UND_ERR_SOCKET"].includes(
      code,
    )
  ) {
    return true;
  }
  if (cause?.message?.toLowerCase().includes("fetch failed")) return true;
  return false;
}

async function probeFirstHealthy(candidates: string[], timeoutMs = PROBE_TIMEOUT_MS): Promise<string | null> {
  for (const host of candidates) {
    if (await probeOllamaHost(host, timeoutMs)) return host;
  }
  return null;
}

/**
 * Resolve a healthy Ollama base URL.
 * Caches briefly; pass `{ force: true }` after failures or for fresh probes.
 */
export async function resolveOllamaHost(opts?: { force?: boolean }): Promise<string> {
  if (!opts?.force && cachedHost && Date.now() - cachedAt < HOST_CACHE_TTL_MS) {
    return cachedHost;
  }

  if (!opts?.force && resolveInFlight) {
    return resolveInFlight;
  }

  const run = async (): Promise<string> => {
    const candidates = buildProbeCandidates();
    const healthy = await probeFirstHealthy(candidates);
    if (healthy) {
      markHostHealthy(healthy);
      return healthy;
    }
    invalidateOllamaHostCache();
    return getConfiguredOllamaHost();
  };

  if (opts?.force) {
    return run();
  }

  resolveInFlight = run().finally(() => {
    resolveInFlight = null;
  });
  return resolveInFlight;
}

async function withHostFailover<T>(
  host: string,
  run: (host: string) => Promise<T>,
): Promise<T> {
  try {
    const result = await run(host);
    markHostHealthy(host);
    return result;
  } catch (err) {
    if (!isConnectionError(err)) throw err;
    invalidateOllamaHostCache();
    const next = await resolveOllamaHost({ force: true });
    if (normalizeHost(next) === normalizeHost(host)) throw err;
    const result = await run(next);
    markHostHealthy(next);
    return result;
  }
}

export async function listRunningModels(host: string): Promise<string[]> {
  try {
    const res = await fetch(`${normalizeHost(host)}/api/ps`);
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

export async function unloadModel(host: string, model: string): Promise<void> {
  await withHostFailover(host, async (activeHost) => {
    try {
      await fetch(`${normalizeHost(activeHost)}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, keep_alive: 0, prompt: "" }),
      });
    } catch (err) {
      if (isConnectionError(err)) throw err;
      // best effort for non-connection errors
    }

    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const running = await listRunningModels(activeHost);
      const stillLoaded = running.some((r) => r.includes(model.split(":")[0]!));
      if (!stillLoaded) return;
      await new Promise((r) => setTimeout(r, 500));
    }
  });
}

export async function ollamaHealth(): Promise<{
  ok: boolean;
  host: string;
  configuredHost: string;
  lastKnownGood: string | null;
  runtime: OllamaRuntime;
  apiInDocker: boolean;
  models: string[];
  running: string[];
  candidates: string[];
  candidatesUp: string[];
  candidateStatus: OllamaCandidateStatus[];
  failoverOk: boolean;
  hints: {
    native: string;
    dockerFromApi: string;
    composeService: string;
  };
}> {
  const configuredHost = getConfiguredOllamaHost();
  const apiInDocker = isApiInDocker();
  const candidates = buildProbeCandidates();
  const candidateStatus: OllamaCandidateStatus[] = [];

  for (const candidate of candidates) {
    const up = await probeOllamaHost(candidate, PROBE_TIMEOUT_MS);
    candidateStatus.push({
      host: candidate,
      up,
      runtime: classifyOllamaRuntime(candidate),
    });
  }

  const candidatesUp = candidateStatus.filter((c) => c.up).map((c) => c.host);
  const host = candidatesUp[0] ?? configuredHost;

  if (candidatesUp[0]) {
    markHostHealthy(candidatesUp[0]);
  } else {
    invalidateOllamaHostCache();
  }

  const runtime = classifyOllamaRuntime(host);
  const failoverOk =
    candidatesUp.length > 0 &&
    (candidatesUp.length > 1 || normalizeHost(host) !== normalizeHost(configuredHost));

  const hints = {
    native: NATIVE_LOOPBACK[0],
    dockerFromApi: HOST_DOCKER_INTERNAL,
    composeService: COMPOSE_OLLAMA,
  };

  try {
    const tagsRes = await fetch(`${normalizeHost(host)}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!tagsRes.ok) {
      return {
        ok: false,
        host,
        configuredHost,
        lastKnownGood,
        runtime,
        apiInDocker,
        models: [],
        running: [],
        candidates,
        candidatesUp,
        candidateStatus,
        failoverOk: false,
        hints,
      };
    }
    const tags = (await tagsRes.json()) as { models?: Array<{ name: string }> };
    const running = await listRunningModels(host);
    return {
      ok: true,
      host,
      configuredHost,
      lastKnownGood,
      runtime,
      apiInDocker,
      models: (tags.models ?? []).map((m) => m.name),
      running,
      candidates,
      candidatesUp,
      candidateStatus,
      failoverOk,
      hints,
    };
  } catch {
    return {
      ok: false,
      host,
      configuredHost,
      lastKnownGood,
      runtime,
      apiInDocker,
      models: [],
      running: [],
      candidates,
      candidatesUp,
      candidateStatus,
      failoverOk: false,
      hints,
    };
  }
}

const DEFAULT_CHAT_TIMEOUT_MS = Number(process.env.OLLAMA_CHAT_TIMEOUT_MS ?? 180_000);
const DEFAULT_VISION_TIMEOUT_MS = Number(process.env.OLLAMA_VISION_TIMEOUT_MS ?? 180_000);

export async function chatCompletion(opts: {
  host: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream?: false;
  timeoutMs?: number;
}): Promise<string> {
  return withHostFailover(opts.host, async (host) => {
    const res = await fetch(`${normalizeHost(host)}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        stream: false,
        keep_alive: 0,
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(formatOllamaHttpError("chat", res.status, await res.text(), host, opts.model));
    }
    const data = (await res.json()) as { message?: { content?: string } };
    return data.message?.content ?? "";
  });
}

async function* streamChatOnce(opts: {
  host: string;
  model: string;
  messages: Array<{
    role: string;
    content: string | Array<{ type: string; text?: string; image_url?: string }>;
  }>;
  signal?: AbortSignal;
}): AsyncGenerator<string> {
  const res = await fetch(`${normalizeHost(opts.host)}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      stream: true,
      keep_alive: 0,
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    const bodyText = res.body ? await res.text() : "no response body";
    throw new Error(
      formatOllamaHttpError("stream", res.status, bodyText, opts.host, opts.model),
    );
  }

  markHostHealthy(opts.host);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const json = JSON.parse(trimmed) as { message?: { content?: string }; done?: boolean };
        if (json.message?.content) {
          yield json.message.content;
        }
      } catch {
        // ignore partial JSON
      }
    }
  }
}

export async function* streamChat(opts: {
  host: string;
  model: string;
  messages: Array<{
    role: string;
    content: string | Array<{ type: string; text?: string; image_url?: string }>;
  }>;
  signal?: AbortSignal;
}): AsyncGenerator<string> {
  try {
    yield* streamChatOnce(opts);
  } catch (err) {
    if (!isConnectionError(err)) throw err;
    invalidateOllamaHostCache();
    const next = await resolveOllamaHost({ force: true });
    if (normalizeHost(next) === normalizeHost(opts.host)) throw err;
    yield* streamChatOnce({ ...opts, host: next });
  }
}

export async function visionExtract(opts: {
  host: string;
  model: string;
  imageBase64: string;
  prompt: string;
  /** Override default vision timeout (ms). */
  timeoutMs?: number;
}): Promise<string> {
  return withHostFailover(opts.host, async (host) => {
    const res = await fetch(`${normalizeHost(host)}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
        messages: [
          {
            role: "user",
            content: opts.prompt,
            images: [opts.imageBase64],
          },
        ],
        stream: false,
        keep_alive: 0,
        format: "json",
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_VISION_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(
        formatOllamaHttpError("vision", res.status, await res.text(), host, opts.model),
      );
    }
    const data = (await res.json()) as { message?: { content?: string } };
    return data.message?.content ?? "{}";
  });
}
