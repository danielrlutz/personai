import { config } from "../config.js";

export type OllamaSlot = "VISION" | "REASONING";

export function modelForSlot(slot: OllamaSlot): string {
  return slot === "VISION" ? config.visionModel : config.reasoningModel;
}

export async function resolveOllamaHost(): Promise<string> {
  const candidates = [config.ollamaHost, "http://127.0.0.1:11434", "http://localhost:11434"];
  for (const host of candidates) {
    try {
      const res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return host;
    } catch {
      // try next
    }
  }
  return config.ollamaHost;
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
  models: string[];
  running: string[];
}> {
  const host = await resolveOllamaHost();
  try {
    const tagsRes = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!tagsRes.ok) {
      return { ok: false, host, models: [], running: [] };
    }
    const tags = (await tagsRes.json()) as { models?: Array<{ name: string }> };
    const running = await listRunningModels(host);
    return {
      ok: true,
      host,
      models: (tags.models ?? []).map((m) => m.name),
      running,
    };
  } catch {
    return { ok: false, host, models: [], running: [] };
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
