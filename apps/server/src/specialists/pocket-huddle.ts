import type { PrismaClient } from "@prisma/client";
import { config } from "../config.js";
import { createConfirmation } from "../confirm/confirm-service.js";
import {
  humanizeOllamaError,
  resolveOllamaHost,
  streamChat,
} from "../ollama/client.js";
import { vramLock } from "../ollama/vram-lock.js";
import { formatSkillsForPrompt } from "../skills/registry.js";
import {
  HISTORY_WINDOW,
  refreshSessionSummaryIfNeeded,
} from "../memory/user-care.js";
import { getSpecialist, resolveSpecialistId } from "./roster.js";
import { resolveSpecialistModel } from "./resolve-model.js";

export const HUDDLE_MAX_SPECIALISTS = 2;

const PROPOSE_ACTIONS = new Set([
  "memory.fact",
  "calendar.event",
  "forge.ship",
  "huddle.propose",
  "premium.spend",
]);

export type HuddleProgress =
  | {
      phase: "started";
      sessionId: string;
      roster: Array<{ id: string; label: string }>;
    }
  | {
      phase: "turn_start";
      index: number;
      total: number;
      specialistId: string;
      label: string;
      model: string;
    }
  | { phase: "token"; specialistId: string; token: string }
  | {
      phase: "turn_done";
      index: number;
      specialistId: string;
      label: string;
      content: string;
    }
  | {
      phase: "confirm_queued";
      confirmationId: string;
      action: string;
      summary: string;
      specialistId: string;
    }
  | {
      phase: "done";
      sessionId: string;
      turns: Array<{ specialistId: string; label: string; content: string }>;
      confirmationIds: string[];
    }
  | { phase: "error"; message: string };

type ProposeBlock = {
  action: string;
  summary: string;
  payload: Record<string, unknown>;
};

function normalizeGuestIds(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const id = resolveSpecialistId(String(item ?? ""));
    if (id === "secretary") continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= HUDDLE_MAX_SPECIALISTS) break;
  }
  return out;
}

function parseProposeBlocks(text: string): ProposeBlock[] {
  const blocks: ProposeBlock[] = [];
  const re = /```propose\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[1]!.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) continue;
    try {
      const parsed = JSON.parse(jsonMatch[0]!) as Partial<ProposeBlock>;
      const action = String(parsed.action ?? "").trim();
      if (!action || !PROPOSE_ACTIONS.has(action)) continue;
      const summary = String(parsed.summary ?? action).trim().slice(0, 200);
      const payload =
        parsed.payload && typeof parsed.payload === "object" && !Array.isArray(parsed.payload)
          ? (parsed.payload as Record<string, unknown>)
          : {};
      blocks.push({ action, summary: summary || action, payload });
    } catch {
      /* ignore malformed */
    }
  }
  return blocks;
}

function stripProposeFences(text: string): string {
  return text.replace(/```propose\s*[\s\S]*?```/gi, "").trim();
}

function huddleSystemExtra(opts: {
  specialistId: string;
  label: string;
  index: number;
  total: number;
  guestLabels: string[];
  priorTakes: Array<{ label: string; content: string }>;
}): string {
  const rosterLine =
    opts.guestLabels.length > 0
      ? `Guests after Staff: ${opts.guestLabels.join(", ")}.`
      : "Staff-only huddle (no guests selected).";
  const prior =
    opts.priorTakes.length === 0
      ? "You speak first."
      : `Prior takes in this huddle:\n${opts.priorTakes
          .map((t) => `### ${t.label}\n${stripProposeFences(t.content).slice(0, 2400)}`)
          .join("\n\n")}`;

  if (opts.specialistId === "secretary") {
    return `

POCKET HUDDLE — you are chairing (turn ${opts.index + 1}/${opts.total}).
${rosterLine}
Give a short framing take: restate the ask, what each guest should cover, and any confirm-gated writes that may be needed later.
Keep it under ~250 words. Do not answer for the guests.
${prior}`;
  }

  return `

POCKET HUDDLE — your turn (${opts.index + 1}/${opts.total}) as ${opts.label}.
${rosterLine}
Give one focused specialist take. Build on Staff and prior guests; do not restate their whole framing.
Never claim a write already ran. If you recommend a confirm-gated write, append a \`\`\`propose JSON fence (see pocket-huddle skill).
${prior}`;
}

/**
 * Staff + up to 2 specialists, sequenced into one ChatSession.
 * Write proposals become PendingConfirmation — never applied here.
 */
export async function runPocketHuddle(opts: {
  prisma: PrismaClient;
  message: string;
  /** Guest specialist ids (0–2). Staff is always first. */
  specialists?: string[];
  sessionId?: string;
  userCare: string;
  onProgress: (event: HuddleProgress) => void;
}): Promise<{
  sessionId: string;
  turns: Array<{ specialistId: string; label: string; content: string }>;
  confirmationIds: string[];
}> {
  const message = opts.message.trim();
  if (!message) throw new Error("message is required");

  const guests = normalizeGuestIds(opts.specialists);
  const speakerIds = ["secretary", ...guests];
  const roster = speakerIds.map((id) => {
    const s = getSpecialist(id);
    return { id, label: s.label };
  });
  const guestLabels = guests.map((id) => getSpecialist(id).label);

  let session = opts.sessionId
    ? await opts.prisma.chatSession.findUnique({ where: { id: opts.sessionId } })
    : null;
  if (!session) {
    session = await opts.prisma.chatSession.create({
      data: {
        title: `Huddle: ${message.slice(0, 48)}`,
        persona: "huddle",
        model: config.reasoningModel,
      },
    });
  } else if (session.persona !== "huddle") {
    session = await opts.prisma.chatSession.update({
      where: { id: session.id },
      data: { persona: "huddle" },
    });
  }

  await opts.prisma.chatMessage.create({
    data: {
      sessionId: session.id,
      role: "USER",
      content: message,
      context: JSON.stringify({ huddle: true, guests }),
    },
  });

  opts.onProgress({ phase: "started", sessionId: session.id, roster });

  const turns: Array<{ specialistId: string; label: string; content: string }> = [];
  const confirmationIds: string[] = [];
  let ollamaHost = "";
  let usedModel = config.reasoningModel;

  const release = await vramLock.acquire("REASONING", () => {
    /* UI gets turn_start / waiting via phases */
  });

  try {
    ollamaHost = await resolveOllamaHost();

    for (let index = 0; index < speakerIds.length; index++) {
      const specialistId = speakerIds[index]!;
      const specialist = getSpecialist(specialistId);
      const resolved = await resolveSpecialistModel(ollamaHost, specialistId);
      usedModel = resolved.model;

      if (session.model !== usedModel) {
        await opts.prisma.chatSession.update({
          where: { id: session.id },
          data: { model: usedModel },
        });
      }

      opts.onProgress({
        phase: "turn_start",
        index,
        total: speakerIds.length,
        specialistId,
        label: specialist.label,
        model: usedModel,
      });

      const historyDesc = await opts.prisma.chatMessage.findMany({
        where: { sessionId: session.id },
        orderBy: { createdAt: "desc" },
        take: HISTORY_WINDOW,
      });
      const history = historyDesc.reverse();

      const skillsBlock = formatSkillsForPrompt(specialistId);
      const skillsExtra = skillsBlock ? `\n\n${skillsBlock}` : "";
      const huddleExtra = huddleSystemExtra({
        specialistId,
        label: specialist.label,
        index,
        total: speakerIds.length,
        guestLabels,
        priorTakes: turns.map((t) => ({ label: t.label, content: t.content })),
      });

      let full = "";
      for await (const token of streamChat({
        host: ollamaHost,
        model: usedModel,
        messages: [
          {
            role: "system",
            content: `${specialist.systemPrompt}\n\n${opts.userCare}${skillsExtra}${huddleExtra}`,
          },
          ...history.map((m) => ({
            role:
              m.role === "USER"
                ? ("user" as const)
                : m.role === "ASSISTANT"
                  ? ("assistant" as const)
                  : ("system" as const),
            content: m.content,
          })),
        ],
      })) {
        full += token;
        opts.onProgress({ phase: "token", specialistId, token });
      }

      if (!full.trim()) {
        full = `(${specialist.label} returned an empty take — continue with the next speaker.)`;
      }

      const displayContent = full.startsWith(`**${specialist.label}:**`)
        ? full
        : `**${specialist.label}:**\n\n${full}`;

      await opts.prisma.chatMessage.create({
        data: {
          sessionId: session.id,
          role: "ASSISTANT",
          content: displayContent,
          context: JSON.stringify({
            huddle: true,
            specialistId,
            label: specialist.label,
            index,
          }),
        },
      });

      turns.push({
        specialistId,
        label: specialist.label,
        content: displayContent,
      });

      opts.onProgress({
        phase: "turn_done",
        index,
        specialistId,
        label: specialist.label,
        content: displayContent,
      });

      for (const block of parseProposeBlocks(full)) {
        const payload = {
          ...block.payload,
          source: String(block.payload.source ?? "pocket-huddle"),
          specialistId,
          huddleSessionId: session.id,
        };
        const confirmation = await createConfirmation(opts.prisma, {
          action: block.action,
          summary: `[Huddle · ${specialist.label}] ${block.summary}`,
          entity: "PocketHuddle",
          payload,
        });
        confirmationIds.push(confirmation.id);
        opts.onProgress({
          phase: "confirm_queued",
          confirmationId: confirmation.id,
          action: block.action,
          summary: block.summary,
          specialistId,
        });
      }
    }

    await opts.prisma.chatSession.update({
      where: { id: session.id },
      data: { updatedAt: new Date(), persona: "huddle", model: usedModel },
    });
    await refreshSessionSummaryIfNeeded(opts.prisma, session.id);

    opts.onProgress({
      phase: "done",
      sessionId: session.id,
      turns,
      confirmationIds,
    });

    return { sessionId: session.id, turns, confirmationIds };
  } catch (err) {
    const msg = humanizeOllamaError(err, ollamaHost || undefined, usedModel);
    opts.onProgress({ phase: "error", message: msg });
    throw new Error(msg);
  } finally {
    await release();
  }
}
