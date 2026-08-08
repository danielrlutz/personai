import fs from "node:fs";
import { config } from "../config.js";

export type OllamaSlot = "VISION" | "REASONING";

/** How Ollama appears relative to this API process. */
export type OllamaRuntime = "native" | "docker" | "remote" | "unknown";

const NATIVE_LOOPBACK = ["http://127.0.0.1:11434", "http://localhost:11434"] as const;

let hostOverride: string | null = null;

export function modelForSlot(slot: OllamaSlot): string {
  return slot === "VISION" ? config.visionModel : config.reasoningModel;
}

export function getConfiguredOllamaHost(): string {
  return (hostOverride ?? config.ollamaHost).replace(/\/$/, "");
}

/** Runtime override (settings UI). Does not rewrite process.env permanently. */
export function setOllamaHostOverride(host: string): void {
  hostOverride = host.trim().replace(/\/$/, "");
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

function buildProbeCandidates(): string[] {
  const configured = getConfiguredOllamaHost();
  const inDocker = isApiInDocker();
  const candidates: string[] = [];

  const push = (host: string | undefined) => {
    if (!host) return;
    const normalized = host.replace(/\/$/, "");
    if (!candidates.includes(normalized)) candidates.push(normalized);
  };

  // Prefer native loopback first when the configured host is loopback or unset-like.
  // When the API runs in Docker against a native Ollama, prefer host.docker.internal
  // over container localhost (which would miss the host process).
  const configuredIsLoopback =
    /^(https?:\/\/)?(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/i.test(configured);

  if (inDocker && configuredIsLoopback) {
    push("http://host.docker.internal:11434");
    push(configured);
  } else {
    push(configured);
  }

  for (const native of NATIVE_LOOPBACK) push(native);

  if (inDocker) {
    push("http://host.docker.internal:11434");
    push("http://ollama:11434");
  } else {
    // Desktop / bare-metal: still try host gateway in case someone pointed compose at us
    push("http://host.docker.internal:11434");
  }

  return candidates;
}

export async function probeOllamaHost(host: string, timeoutMs = 2000): Promise<boolean> {
  try {
    const res = await fetch(`${host.replace(/\/$/, "")}/api/tags`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function resolveOllamaHost(): Promise<string> {
  const candidates = buildProbeCandidates();
  for (const host of candidates) {
    if (await probeOllamaHost(host)) return host;
  }
  return getConfiguredOllamaHost();
}

export async function listRunningModels(host: string): Promise<string[]> {
  try {
    const res = await fetch(`${host}/api/ps`);
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

export async function unloadModel(host: string, model: string): Promise<void> {
  try {
    await fetch(`${host}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, keep_alive: 0, prompt: "" }),
    });
  } catch {
    // best effort
  }

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const running = await listRunningModels(host);
    const stillLoaded = running.some((r) => r.includes(model.split(":")[0]!));
    if (!stillLoaded) return;
    await new Promise((r) => setTimeout(r, 500));
  }
}

export async function ollamaHealth(): Promise<{
  ok: boolean;
  host: string;
  configuredHost: string;
  runtime: OllamaRuntime;
  apiInDocker: boolean;
  models: string[];
  running: string[];
}> {
  const configuredHost = getConfiguredOllamaHost();
  const apiInDocker = isApiInDocker();
  const host = await resolveOllamaHost();
  const runtime = classifyOllamaRuntime(host);

  try {
    const tagsRes = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!tagsRes.ok) {
      return { ok: false, host, configuredHost, runtime, apiInDocker, models: [], running: [] };
    }
    const tags = (await tagsRes.json()) as { models?: Array<{ name: string }> };
    const running = await listRunningModels(host);
    return {
      ok: true,
      host,
      configuredHost,
      runtime,
      apiInDocker,
      models: (tags.models ?? []).map((m) => m.name),
      running,
    };
  } catch {
    return { ok: false, host, configuredHost, runtime, apiInDocker, models: [], running: [] };
  }
}

export async function chatCompletion(opts: {
  host: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream?: false;
}): Promise<string> {
  const res = await fetch(`${opts.host}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      stream: false,
      keep_alive: 0,
    }),
  });
  if (!res.ok) {
    throw new Error(`Ollama chat failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { message?: { content?: string } };
  return data.message?.content ?? "";
}

export async function* streamChat(opts: {
  host: string;
  model: string;
  messages: Array<{ role: string; content: string | Array<{ type: string; text?: string; image_url?: string }> }>;
  signal?: AbortSignal;
}): AsyncGenerator<string> {
  const res = await fetch(`${opts.host}/api/chat`, {
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
    throw new Error(`Ollama stream failed: ${res.status} ${await res.text()}`);
  }

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

export async function visionExtract(opts: {
  host: string;
  model: string;
  imageBase64: string;
  prompt: string;
}): Promise<string> {
  const res = await fetch(`${opts.host}/api/chat`, {
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
  });
  if (!res.ok) {
    throw new Error(`Ollama vision failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { message?: { content?: string } };
  return data.message?.content ?? "{}";
}
