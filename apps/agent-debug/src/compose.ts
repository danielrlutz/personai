import path from "node:path";
import {
  buildComposeSystemPrompt,
  buildComposeSystemPromptMinimal,
  buildContextPreamble,
  getStaticComposeContext,
} from "./compose/system-prompts.js";
import { config } from "./config.js";
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

function batchTotalTextChars(messages: InboxMessage[]): number {
  return messages.reduce((n, m) => n + m.text.trim().length, 0);
}

function batchHasImages(messages: InboxMessage[]): boolean {
  return messages.some((m) => m.images.length > 0);
}

/** Text-only, non-urgent, under threshold — skip Ollama. */
export function shouldSkipCompose(messages: InboxMessage[]): boolean {
  const threshold = config.composeSkipThresholdChars;
  if (threshold <= 0) return false;
  if (messages.some((m) => m.urgent)) return false;
  if (batchHasImages(messages)) return false;
  const chars = batchTotalTextChars(messages);
  return chars > 0 && chars <= threshold;
}

/** Template prompt for trivial batches (no Ollama). */
export function buildLightweightPrompt(messages: InboxMessage[]): string {
  const urgent = messages.some((m) => m.urgent);
  const body =
    messages.length === 1
      ? messages[0]!.text.trim()
      : messages.map((m, i) => formatMessageBlock(m, i)).join("\n\n");

  return [
    getStaticComposeContext(),
    "",
    urgent ? "Priority: URGENT" : "",
    "",
    "## User request",
    body,
    "",
    "Treat the above as a single balcony/phone turn. Respond and take action in this Cursor session.",
  ]
    .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
    .join("\n");
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

  if (shouldSkipCompose(messages)) {
    const chars = batchTotalTextChars(messages);
    console.log(
      `[agent-debug] compose skip batch=${batch.id} (${chars} chars, threshold=${config.composeSkipThresholdChars})`,
    );
    return buildLightweightPrompt(messages);
  }

  const fallback = fallbackCompose(messages);
  const rawBundle = messages.map((m, i) => formatMessageBlock(m, i)).join("\n\n");
  const minimal = config.composeMinimalMode;
  const system = minimal
    ? buildComposeSystemPromptMinimal()
    : buildComposeSystemPrompt();

  const userPrompt = minimal
    ? [
        "## Static context",
        getStaticComposeContext(),
        "",
        "Combine these inbox messages into one Cursor-ready agent prompt:",
        "",
        rawBundle,
      ].join("\n")
    : [
        "Combine these user messages (and image captions/paths) into one Cursor-ready agent prompt:",
        "",
        rawBundle,
      ].join("\n");

  console.log(
    `[agent-debug] compose ollama batch=${batch.id} model=${config.composeModel} minimal=${minimal}`,
  );

  try {
    const composed = await ollamaChat({
      model: config.composeModel,
      system,
      prompt: userPrompt,
      timeoutMs: 90_000,
    });
    if (!composed || composed.length < 20) return fallback;
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
