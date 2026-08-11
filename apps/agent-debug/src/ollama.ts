import fs from "node:fs";
import { config } from "./config.js";

export async function ollamaTags(): Promise<string[]> {
  try {
    const res = await fetch(`${config.ollamaHost}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { models?: Array<{ name?: string }> };
    return (body.models ?? []).map((m) => m.name ?? "").filter(Boolean);
  } catch {
    return [];
  }
}

export async function ollamaChat(opts: {
  model: string;
  system?: string;
  prompt: string;
  imagesBase64?: string[];
  timeoutMs?: number;
}): Promise<string> {
  const messages: Array<Record<string, unknown>> = [];
  if (opts.system) {
    messages.push({ role: "system", content: opts.system });
  }
  const user: Record<string, unknown> = { role: "user", content: opts.prompt };
  if (opts.imagesBase64?.length) {
    user.images = opts.imagesBase64;
  }
  messages.push(user);

  const res = await fetch(`${config.ollamaHost}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      stream: false,
      messages,
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ollama chat ${res.status}: ${text.slice(0, 300)}`);
  }
  const body = (await res.json()) as {
    message?: { content?: string };
  };
  return (body.message?.content ?? "").trim();
}

export function fileToBase64(filePath: string): string {
  return fs.readFileSync(filePath).toString("base64");
}

export async function modelAvailable(name: string): Promise<boolean> {
  if (!name) return false;
  const tags = await ollamaTags();
  const needle = name.toLowerCase();
  return tags.some(
    (t) => t.toLowerCase() === needle || t.toLowerCase().startsWith(`${needle}:`),
  );
}
