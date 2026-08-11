import path from "node:path";
import { buildContextPreamble, config } from "./config.js";
import { ollamaChat } from "./ollama.js";
import { store } from "./store.js";
import type { Batch, InboxMessage } from "./types.js";

function formatMessageBlock(msg: InboxMessage, index: number): string {
  const lines = [`### Message ${index + 1} (${msg.createdAt})${msg.urgent ? " [URGENT]" : ""}`];
  if (msg.text.trim()) lines.push(msg.text.trim());
  else lines.push("(no text)");
  if (msg.images.length) {
    lines.push("Images:");
    for (const img of msg.images) {
      lines.push(`- ${img.caption || img.filename}`);
      lines.push(`  path: ${img.path}`);
      if (img.thumbPath) lines.push(`  thumb: ${img.thumbPath}`);
    }
  }
  return lines.join("\n");
}

export function fallbackCompose(messages: InboxMessage[]): string {
  const preamble = buildContextPreamble();
  const body = messages.map((m, i) => formatMessageBlock(m, i)).join("\n\n");
  const urgent = messages.some((m) => m.urgent);
  return [
    preamble,
    "",
    urgent ? "Priority: URGENT" : "Priority: normal",
    "",
    "## User inbox batch",
    body,
    "",
    "## Instruction",
    "Treat the above as a single user turn from the phone/balcony inbox. Respond and take action in this Cursor session.",
  ].join("\n");
}

export async function composeBatchPrompt(batch: Batch): Promise<string> {
  const messages = batch.messageIds
    .map((id) => store.getMessage(id))
    .filter((m): m is InboxMessage => Boolean(m));

  if (!messages.length) {
    throw new Error("batch has no messages");
  }

  const fallback = fallbackCompose(messages);
  const rawBundle = messages.map((m, i) => formatMessageBlock(m, i)).join("\n\n");

  try {
    const composed = await ollamaChat({
      model: config.composeModel,
      system: [
        "You rewrite a short phone chat dump into ONE clear prompt for a Cursor coding agent.",
        "Keep all concrete facts, paths, filenames, and user intent.",
        "Do not invent requirements. Prefer imperative instructions.",
        "Output only the prompt text, no preamble.",
        `Start with this context block:\n${buildContextPreamble()}`,
      ].join("\n"),
      prompt: [
        "Combine these user messages (and image captions/paths) into one Cursor-ready agent prompt:",
        "",
        rawBundle,
      ].join("\n"),
      timeoutMs: 90_000,
    });
    if (!composed || composed.length < 20) return fallback;
    // Ensure absolute image paths remain visible
    const pathLines = messages.flatMap((m) =>
      m.images.map((img) => `- ${path.resolve(img.path)}`),
    );
    if (pathLines.length && !/[/\\]uploads[/\\]/i.test(composed)) {
      return `${composed}\n\n## Attached image paths\n${pathLines.join("\n")}`;
    }
    return composed;
  } catch {
    return fallback;
  }
}
