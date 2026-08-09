import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import {
  ARCHIVE_TAXONOMY,
  SPECIALISTS,
  getSpecialist,
  resolveSpecialistId,
} from "../specialists/roster.js";
import { humanizeOllamaError, resolveOllamaHost, streamChat } from "../ollama/client.js";
import { vramLock } from "../ollama/vram-lock.js";
import {
  HISTORY_WINDOW,
  buildSlimLiveOps,
  formatUserCareContext,
  getCeoProfileCard,
  listRecentMemoryFacts,
  refreshSessionSummaryIfNeeded,
} from "../memory/user-care.js";
import { sendError, sseWrite, withPrisma } from "./helpers.js";

type ChatBody = {
  message?: string;
  sessionId?: string;
  specialist?: string;
  persona?: string;
};

export async function registerTeamRoutes(app: FastifyInstance): Promise<void> {
  app.get("/specialists", async () => ({
    specialists: SPECIALISTS.map(({ id, label, shortLabel, description, group }) => ({
      id,
      label,
      shortLabel,
      description,
      group,
    })),
    taxonomy: ARCHIVE_TAXONOMY,
  }));

  async function streamSpecialistChat(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = (req.body ?? {}) as ChatBody;
    if (!body.message?.trim()) {
      reply.status(400).send({ error: "message is required" });
      return;
    }
    const { prisma } = await withPrisma(req);
    const specialistId = resolveSpecialistId(body.specialist ?? body.persona);
    const specialist = getSpecialist(specialistId);
    let session = body.sessionId
      ? await prisma.chatSession.findUnique({ where: { id: body.sessionId } })
      : null;
    if (!session) {
      session = await prisma.chatSession.create({
        data: {
          title: body.message.slice(0, 60),
          persona: specialistId,
          model: config.reasoningModel,
        },
      });
    }

    const [ceo, facts, liveOps] = await Promise.all([
      getCeoProfileCard(prisma),
      listRecentMemoryFacts(prisma),
      buildSlimLiveOps(prisma, specialistId),
    ]);
    const userCare = formatUserCareContext({
      ceo,
      facts,
      liveOps,
      sessionSummary: session.sessionSummary,
    });

    await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: "USER",
        content: body.message,
        context: JSON.stringify(liveOps),
      },
    });

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    sseWrite(reply, "context", {
      sessionId: session.id,
      specialist: specialistId,
      vram: vramLock.getState(),
    });
    const release = await vramLock.acquire("REASONING", (reason) => {
      sseWrite(reply, "context", { waiting: true, reason });
    });
    let full = "";
    let ollamaHost = "";
    try {
      ollamaHost = await resolveOllamaHost();
      // Recent N messages (newest first from DB), then chronological for the model.
      const historyDesc = await prisma.chatMessage.findMany({
        where: { sessionId: session.id },
        orderBy: { createdAt: "desc" },
        take: HISTORY_WINDOW,
      });
      const history = historyDesc.reverse();

      for await (const token of streamChat({
        host: ollamaHost,
        model: config.reasoningModel,
        messages: [
          {
            role: "system",
            content: `${specialist.systemPrompt}\n\n${userCare}`,
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
      sseWrite(reply, "done", {
        sessionId: session.id,
        content: full,
        specialist: specialistId,
      });
    } catch (err) {
      const message = humanizeOllamaError(err, ollamaHost || undefined, config.reasoningModel);
      sseWrite(reply, "error", { message, error: message });
    } finally {
      await release();
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
}
