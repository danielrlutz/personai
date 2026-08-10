import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import {
  ARCHIVE_TAXONOMY,
  SPECIALISTS,
  STYLIST_VISION_PROMPT,
  getSpecialist,
  modelNameForPref,
  resolveSpecialistId,
} from "../specialists/roster.js";
import { resolveSpecialistModel } from "../specialists/resolve-model.js";
import { runForgeQaLoop } from "../specialists/forge-qa-loop.js";
import { runPocketHuddle } from "../specialists/pocket-huddle.js";
import {
  humanizeOllamaError,
  resolveOllamaHost,
  streamChat,
  visionDescribe,
} from "../ollama/client.js";
import { vramLock } from "../ollama/vram-lock.js";
import {
  HISTORY_WINDOW,
  buildSlimLiveOps,
  formatUserCareContext,
  getCeoProfileCard,
  listRecentMemoryFacts,
  refreshSessionSummaryIfNeeded,
  type ArchiveCareContext,
} from "../memory/user-care.js";
import { loadStagingForPrompt } from "../memory/staging.js";
import { driveStatus } from "../archive/drive.js";
import {
  ARCHIVE_INDEX_KEY,
  ARCHIVE_REFRESHED_KEY,
  ARCHIVE_TAXONOMY_KEY,
} from "../archive/init-context.js";
import {
  citationModeInstructions,
  collectReplyCitations,
  formatCitableDocsBlock,
  listCitableDocuments,
  type CitableDoc,
} from "../memory/citable-docs.js";
import { formatSkillsForPrompt, listSkillCatalog } from "../skills/registry.js";
import { sendError, sseStart, sseWrite, withPrisma } from "./helpers.js";

type ChatBody = {
  message?: string;
  sessionId?: string;
  specialist?: string;
  persona?: string;
  /** Raw base64 (optionally data-URL) for Stylist photo analysis. */
  imageBase64?: string;
  imageMimeType?: string;
  /** Strict grounding: cite only from local archive list (Legal / CFO / Medical). */
  citeFromArchive?: boolean;
};

type HuddleBody = {
  message?: string;
  sessionId?: string;
  /** Up to 2 guest specialists after Staff. */
  specialists?: string[];
};

type ForgeQaBody = {
  brief?: string;
  sessionId?: string;
};

function stripDataUrl(base64: string): string {
  return base64.replace(/^data:image\/\w+;base64,/, "").trim();
}

export async function registerTeamRoutes(app: FastifyInstance): Promise<void> {
  app.get("/specialists", async () => ({
    specialists: SPECIALISTS.map(
      ({ id, label, shortLabel, description, group, modelPref }) => ({
        id,
        label,
        shortLabel,
        description,
        group,
        modelPref,
        preferredModel: modelNameForPref(modelPref),
      }),
    ),
    taxonomy: ARCHIVE_TAXONOMY,
    skills: listSkillCatalog(),
    models: {
      reasoning: config.reasoningModel,
      coder: config.coderModel,
      vision: config.visionModel,
    },
  }));

  async function loadUserCare(
    prisma: Awaited<ReturnType<typeof withPrisma>>["prisma"],
    profileId: string,
    specialistId: string,
    sessionSummary: string | null | undefined,
    opts?: { citeFromArchive?: boolean },
  ) {
    const [ceo, facts, liveOps, archiveFacts, citables, staging] = await Promise.all([
      getCeoProfileCard(prisma),
      listRecentMemoryFacts(prisma),
      buildSlimLiveOps(prisma, specialistId),
      prisma.memoryFact.findMany({
        where: {
          key: { in: [ARCHIVE_INDEX_KEY, ARCHIVE_TAXONOMY_KEY, ARCHIVE_REFRESHED_KEY] },
        },
      }),
      listCitableDocuments(prisma),
      loadStagingForPrompt(profileId),
    ]);
    const drive = driveStatus();
    const archiveMap = new Map(archiveFacts.map((f) => [f.key, f.value]));
    const archive: ArchiveCareContext = {
      linked: drive.linked || drive.enabled,
      ready: Boolean(archiveMap.get(ARCHIVE_INDEX_KEY)?.trim()),
      message: drive.message,
      index: archiveMap.get(ARCHIVE_INDEX_KEY) ?? null,
      taxonomy: archiveMap.get(ARCHIVE_TAXONOMY_KEY) ?? null,
      refreshedAt: archiveMap.get(ARCHIVE_REFRESHED_KEY) ?? null,
      citablesBlock: formatCitableDocsBlock(citables),
    };
    return {
      userCare: formatUserCareContext({
        ceo,
        facts,
        liveOps,
        sessionSummary,
        archive,
        stagingBlock: staging.block,
        extraInstructions: citationModeInstructions(Boolean(opts?.citeFromArchive)),
      }),
      liveOps,
      archive,
      citables,
    };
  }

  async function streamSpecialistChat(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = (req.body ?? {}) as ChatBody;
    if (!body.message?.trim() && !body.imageBase64?.trim()) {
      reply.status(400).send({ error: "message or image is required" });
      return;
    }
    const { prisma, profileId } = await withPrisma(req);
    const specialistId = resolveSpecialistId(body.specialist ?? body.persona);
    const specialist = getSpecialist(specialistId);
    const hasImage = Boolean(body.imageBase64?.trim());
    if (hasImage && specialistId !== "stylist") {
      reply.status(400).send({
        error: "Photo upload is only available when Stylist is selected.",
      });
      return;
    }

    let session = body.sessionId
      ? await prisma.chatSession.findUnique({ where: { id: body.sessionId } })
      : null;
    if (!session) {
      session = await prisma.chatSession.create({
        data: {
          title: (body.message || "Stylist photo").slice(0, 60),
          persona: specialistId,
          model: config.reasoningModel,
        },
      });
    }

    const citeFromArchive = Boolean(body.citeFromArchive);
    const { userCare, liveOps, archive, citables } = await loadUserCare(
      prisma,
      profileId,
      specialistId,
      session.sessionSummary,
      { citeFromArchive },
    );
    const citableDocs: CitableDoc[] = citables;

    const userText =
      body.message?.trim() ||
      (hasImage ? "Please analyze this photo for wardrobe and presentation coaching." : "");

    await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: "USER",
        content: hasImage ? `${userText}\n\n[photo attached]` : userText,
        context: JSON.stringify({ ...liveOps, hasImage, citeFromArchive }),
      },
    });

    sseStart(reply, req);
    sseWrite(reply, "context", {
      sessionId: session.id,
      specialist: specialistId,
      vram: vramLock.getState(),
      archiveLinked: archive.linked,
      archiveReady: archive.ready,
      citeFromArchive,
      citableCount: citables.length,
    });

    let full = "";
    let ollamaHost = "";
    let usedModel = config.reasoningModel;
    let visionNotes: string | null = null;
    let releaseReasoning: (() => Promise<void>) | null = null;

    try {
      ollamaHost = await resolveOllamaHost();

      if (hasImage && specialistId === "stylist") {
        const releaseVision = await vramLock.acquire("VISION", (reason) => {
          sseWrite(reply, "context", { waiting: true, reason, phase: "vision" });
        });
        try {
          sseWrite(reply, "context", {
            phase: "vision",
            model: config.visionModel,
          });
          visionNotes = await visionDescribe({
            host: ollamaHost,
            model: config.visionModel,
            imageBase64: stripDataUrl(body.imageBase64!),
            prompt: STYLIST_VISION_PROMPT,
          });
          if (!visionNotes) {
            visionNotes =
              "(Vision model returned no notes ??? coach from the user's description.)";
          }
        } finally {
          await releaseVision();
        }
      }

      releaseReasoning = await vramLock.acquire("REASONING", (reason) => {
        sseWrite(reply, "context", { waiting: true, reason });
      });
      const resolved = await resolveSpecialistModel(ollamaHost, specialistId);
      usedModel = resolved.model;
      if (session.model !== usedModel) {
        await prisma.chatSession.update({
          where: { id: session.id },
          data: { model: usedModel },
        });
      }
      sseWrite(reply, "context", {
        model: usedModel,
        modelPref: resolved.pref,
        modelFallback: resolved.fallback,
        preferredModel: resolved.preferredModel,
      });

      const historyDesc = await prisma.chatMessage.findMany({
        where: { sessionId: session.id },
        orderBy: { createdAt: "desc" },
        take: HISTORY_WINDOW,
      });
      const history = historyDesc.reverse();

      const systemExtra = visionNotes
        ? `\n\nVISION NOTES FROM USER PHOTO (treat as what you see):\n${visionNotes}`
        : "";
      const skillsBlock = formatSkillsForPrompt(specialistId);
      const skillsExtra = skillsBlock ? `\n\n${skillsBlock}` : "";

      for await (const token of streamChat({
        host: ollamaHost,
        model: usedModel,
        messages: [
          {
            role: "system",
            content: `${specialist.systemPrompt}\n\n${userCare}${skillsExtra}${systemExtra}`,
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
        sseWrite(reply, "token", { token });
      }

      await prisma.chatMessage.create({
        data: { sessionId: session.id, role: "ASSISTANT", content: full },
      });
      await prisma.chatSession.update({
        where: { id: session.id },
        data: { updatedAt: new Date(), persona: specialistId },
      });
      await refreshSessionSummaryIfNeeded(prisma, session.id);
      const citations = collectReplyCitations(full, citableDocs);
      sseWrite(reply, "done", {
        sessionId: session.id,
        content: full,
        specialist: specialistId,
        model: usedModel,
        hadVision: Boolean(visionNotes),
        citeFromArchive,
        citations,
      });
    } catch (err) {
      const message = humanizeOllamaError(err, ollamaHost || undefined, usedModel);
      sseWrite(reply, "error", { message, error: message });
    } finally {
      if (releaseReasoning) await releaseReasoning();
      reply.raw.end();
    }
  }

  app.post("/team/chat/stream", async (req, reply) => {
    try {
      await streamSpecialistChat(req, reply);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post("/advisor/chat/stream", async (req, reply) => {
    try {
      await streamSpecialistChat(req, reply);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  /** Automated Forge ??? QA ??? retry ??? forge.ship confirm. */
  app.post("/team/forge-qa/stream", async (req, reply) => {
    try {
      const body = (req.body ?? {}) as ForgeQaBody;
      if (!body.brief?.trim()) {
        return reply.status(400).send({ error: "brief is required" });
      }
      const { prisma, profileId } = await withPrisma(req);
      const { userCare } = await loadUserCare(prisma, profileId, "forge", null);

      sseStart(reply, req);

      try {
        const result = await runForgeQaLoop({
          prisma,
          brief: body.brief,
          userCare,
          onProgress: (event) => {
            sseWrite(reply, event.phase, event);
          },
        });
        sseWrite(reply, "result", result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        sseWrite(reply, "error", { message, error: message });
      } finally {
        reply.raw.end();
      }
    } catch (err) {
      return sendError(reply, err);
    }
  });

  /** Staff + up to 2 specialists sequenced into one Team thread. */
  app.post("/team/huddle/stream", async (req, reply) => {
    try {
      const body = (req.body ?? {}) as HuddleBody;
      if (!body.message?.trim()) {
        return reply.status(400).send({ error: "message is required" });
      }
      const guests = Array.isArray(body.specialists)
        ? body.specialists.map(String).slice(0, 2)
        : [];
      const { prisma, profileId } = await withPrisma(req);
      const { userCare } = await loadUserCare(prisma, profileId, "secretary", null);

      sseStart(reply, req);
      sseWrite(reply, "context", { kind: "huddle", guests });

      try {
        const result = await runPocketHuddle({
          prisma,
          message: body.message,
          specialists: guests,
          sessionId: body.sessionId,
          userCare,
          onProgress: (event) => {
            sseWrite(reply, event.phase, event);
          },
        });
        sseWrite(reply, "result", result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        sseWrite(reply, "error", { message, error: message });
      } finally {
        reply.raw.end();
      }
    } catch (err) {
      return sendError(reply, err);
    }
  });

}
