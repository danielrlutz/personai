// @ts-nocheck
import { config } from "../config.js";
import { ARCHIVE_TAXONOMY, SPECIALISTS, getSpecialist, resolveSpecialistId, } from "../specialists/roster.js";
import { listPendingConfirmations } from "../confirm/confirm-service.js";
import { resolveOllamaHost, streamChat } from "../ollama/client.js";
import { vramLock } from "../ollama/vram-lock.js";
import { sendError, sseWrite, withPrisma } from "./helpers.js";
export async function registerTeamRoutes(app) {
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
    async function streamSpecialistChat(req, reply) {
        const body = (req.body ?? {});
        if (!body.message?.trim()) {
            return reply.status(400).send({ error: "message is required" });
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
        const budget = await prisma.budgetCategory.findMany({ include: { transactions: true } });
        const bills = await prisma.qRBill.findMany({ where: { status: "PENDING" }, take: 10 });
        const tasks = await prisma.legalTask.findMany({
            where: { status: { in: ["TODO", "IN_PROGRESS"] } },
            take: 10,
        });
        const pending = await listPendingConfirmations(prisma);
        const context = {
            specialist: specialistId,
            budget,
            bills,
            tasks,
            pendingConfirmations: pending.map((c) => ({
                id: c.id,
                action: c.action,
                summary: c.summary,
            })),
            taxonomy: ARCHIVE_TAXONOMY,
        };
        await prisma.chatMessage.create({
            data: {
                sessionId: session.id,
                role: "USER",
                content: body.message,
                context: JSON.stringify(context),
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
        try {
            const host = await resolveOllamaHost();
            const history = await prisma.chatMessage.findMany({
                where: { sessionId: session.id },
                orderBy: { createdAt: "asc" },
                take: 20,
            });
            for await (const token of streamChat({
                host,
                model: config.reasoningModel,
                messages: [
                    {
                        role: "system",
                        content: `${specialist.systemPrompt}\n\nLive context (JSON):\n${JSON.stringify(context)}`,
                    },
                    ...history.map((m) => ({
                        role: m.role === "USER" ? "user" : m.role === "ASSISTANT" ? "assistant" : "system",
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
            sseWrite(reply, "done", { sessionId: session.id, content: full, specialist: specialistId });
        }
        catch (err) {
            sseWrite(reply, "error", {
                message: err instanceof Error ? err.message : String(err),
            });
        }
        finally {
            await release();
            reply.raw.end();
        }
    }
    app.post("/team/chat/stream", async (req, reply) => {
        try {
            await streamSpecialistChat(req, reply);
        }
        catch (err) {
            return sendError(reply, err);
        }
    });
    app.post("/advisor/chat/stream", async (req, reply) => {
        try {
            await streamSpecialistChat(req, reply);
        }
        catch (err) {
            return sendError(reply, err);
        }
    });
}
//# sourceMappingURL=team.js.map