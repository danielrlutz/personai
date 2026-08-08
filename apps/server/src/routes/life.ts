import type { FastifyInstance } from "fastify";
import { buildPersonalTodaySummary, endOfDay, startOfDay } from "../life/life-service.js";
import { sendError, withPrisma } from "./helpers.js";

type HabitFrequency = "DAILY" | "WEEKLY" | "CUSTOM";
type PersonalGoalStatus = "ACTIVE" | "PAUSED" | "COMPLETED" | "ABANDONED";
type PersonalTaskStatus = "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED";
type LifeDomain = "PERSONAL" | "BUSINESS" | "BOTH";

export async function registerLifeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/life/today", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      return await buildPersonalTodaySummary(prisma);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // Habits
  app.get("/life/habits", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const todayStart = startOfDay();
      const todayEnd = endOfDay();
      const habits = await prisma.habit.findMany({
        orderBy: [{ active: "desc" }, { title: "asc" }],
        include: {
          logs: {
            where: { loggedAt: { gte: todayStart, lte: todayEnd } },
            orderBy: { loggedAt: "desc" },
          },
        },
      });
      return { habits };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post<{
    Body: {
      title: string;
      description?: string;
      frequency?: HabitFrequency;
      customRule?: string;
      domain?: LifeDomain;
      targetCount?: number;
      active?: boolean;
    };
  }>("/life/habits", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const title = req.body.title?.trim();
      if (!title) return reply.status(400).send({ error: "title is required" });
      const habit = await prisma.habit.create({
        data: {
          title,
          description: req.body.description,
          frequency: req.body.frequency ?? "DAILY",
          customRule: req.body.customRule,
          domain: req.body.domain ?? "PERSONAL",
          targetCount: req.body.targetCount ?? 1,
          active: req.body.active ?? true,
        },
      });
      return habit;
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.patch<{
    Params: { id: string };
    Body: {
      title?: string;
      description?: string | null;
      frequency?: HabitFrequency;
      customRule?: string | null;
      domain?: LifeDomain;
      targetCount?: number;
      active?: boolean;
    };
  }>("/life/habits/:id", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const habit = await prisma.habit.update({
        where: { id: req.params.id },
        data: {
          title: req.body.title,
          description: req.body.description,
          frequency: req.body.frequency,
          customRule: req.body.customRule,
          domain: req.body.domain,
          targetCount: req.body.targetCount,
          active: req.body.active,
        },
      });
      return habit;
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post<{ Params: { id: string }; Body: { note?: string; loggedAt?: string } }>(
    "/life/habits/:id/log",
    async (req, reply) => {
      try {
        const { prisma } = await withPrisma(req);
        const habit = await prisma.habit.findUnique({ where: { id: req.params.id } });
        if (!habit) return reply.status(404).send({ error: "Habit not found" });
        const log = await prisma.habitLog.create({
          data: {
            habitId: habit.id,
            note: req.body.note,
            loggedAt: req.body.loggedAt ? new Date(req.body.loggedAt) : new Date(),
          },
        });
        return log;
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );

  app.delete<{ Params: { id: string }; Querystring: { logId?: string } }>(
    "/life/habits/:id/log",
    async (req, reply) => {
      try {
        const { prisma } = await withPrisma(req);
        const todayStart = startOfDay();
        const todayEnd = endOfDay();
        if (req.query.logId) {
          await prisma.habitLog.delete({ where: { id: req.query.logId } });
          return { ok: true };
        }
        const latest = await prisma.habitLog.findFirst({
          where: {
            habitId: req.params.id,
            loggedAt: { gte: todayStart, lte: todayEnd },
          },
          orderBy: { loggedAt: "desc" },
        });
        if (!latest) return reply.status(404).send({ error: "No habit log for today" });
        await prisma.habitLog.delete({ where: { id: latest.id } });
        return { ok: true };
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );

  // Goals
  app.get("/life/goals", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const goals = await prisma.personalGoal.findMany({
        orderBy: [{ status: "asc" }, { targetDate: "asc" }],
        include: { tasks: { where: { status: { in: ["TODO", "IN_PROGRESS"] } }, take: 10 } },
      });
      return { goals };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post<{
    Body: {
      title: string;
      description?: string;
      status?: PersonalGoalStatus;
      domain?: LifeDomain;
      targetDate?: string;
      progress?: number;
    };
  }>("/life/goals", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const title = req.body.title?.trim();
      if (!title) return reply.status(400).send({ error: "title is required" });
      const goal = await prisma.personalGoal.create({
        data: {
          title,
          description: req.body.description,
          status: req.body.status ?? "ACTIVE",
          domain: req.body.domain ?? "PERSONAL",
          targetDate: req.body.targetDate ? new Date(req.body.targetDate) : null,
          progress: req.body.progress ?? 0,
        },
      });
      return goal;
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.patch<{
    Params: { id: string };
    Body: {
      title?: string;
      description?: string | null;
      status?: PersonalGoalStatus;
      domain?: LifeDomain;
      targetDate?: string | null;
      progress?: number;
    };
  }>("/life/goals/:id", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const goal = await prisma.personalGoal.update({
        where: { id: req.params.id },
        data: {
          title: req.body.title,
          description: req.body.description,
          status: req.body.status,
          domain: req.body.domain,
          targetDate:
            req.body.targetDate === undefined
              ? undefined
              : req.body.targetDate
                ? new Date(req.body.targetDate)
                : null,
          progress: req.body.progress,
        },
      });
      return goal;
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // Tasks
  app.get("/life/tasks", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const tasks = await prisma.personalTask.findMany({
        orderBy: [{ status: "asc" }, { dueDate: "asc" }],
        include: { goal: true },
      });
      return { tasks };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post<{
    Body: {
      title: string;
      description?: string;
      status?: PersonalTaskStatus;
      domain?: LifeDomain;
      dueDate?: string;
      goalId?: string;
    };
  }>("/life/tasks", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const title = req.body.title?.trim();
      if (!title) return reply.status(400).send({ error: "title is required" });
      const task = await prisma.personalTask.create({
        data: {
          title,
          description: req.body.description,
          status: req.body.status ?? "TODO",
          domain: req.body.domain ?? "PERSONAL",
          dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null,
          goalId: req.body.goalId,
        },
      });
      return task;
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.patch<{
    Params: { id: string };
    Body: {
      title?: string;
      description?: string | null;
      status?: PersonalTaskStatus;
      domain?: LifeDomain;
      dueDate?: string | null;
      goalId?: string | null;
    };
  }>("/life/tasks/:id", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const task = await prisma.personalTask.update({
        where: { id: req.params.id },
        data: {
          title: req.body.title,
          description: req.body.description,
          status: req.body.status,
          domain: req.body.domain,
          dueDate:
            req.body.dueDate === undefined
              ? undefined
              : req.body.dueDate
                ? new Date(req.body.dueDate)
                : null,
          goalId: req.body.goalId,
          completedAt:
            req.body.status === "DONE"
              ? new Date()
              : req.body.status
                ? null
                : undefined,
        },
      });
      return task;
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // Touchpoints
  app.get("/life/touchpoints", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const touchpoints = await prisma.relationshipTouchpoint.findMany({
        orderBy: [{ nextDueAt: "asc" }, { contactName: "asc" }],
      });
      return { touchpoints };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post<{
    Body: {
      contactName: string;
      relationship?: string;
      domain?: LifeDomain;
      cadenceDays?: number;
      lastContactedAt?: string;
      nextDueAt?: string;
      notes?: string;
    };
  }>("/life/touchpoints", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const contactName = req.body.contactName?.trim();
      if (!contactName) return reply.status(400).send({ error: "contactName is required" });
      const cadenceDays = req.body.cadenceDays ?? 30;
      const lastContactedAt = req.body.lastContactedAt ? new Date(req.body.lastContactedAt) : null;
      let nextDueAt = req.body.nextDueAt ? new Date(req.body.nextDueAt) : null;
      if (!nextDueAt) {
        const base = lastContactedAt ?? new Date();
        nextDueAt = new Date(base);
        nextDueAt.setDate(nextDueAt.getDate() + cadenceDays);
      }
      const touchpoint = await prisma.relationshipTouchpoint.create({
        data: {
          contactName,
          relationship: req.body.relationship,
          domain: req.body.domain ?? "PERSONAL",
          cadenceDays,
          lastContactedAt,
          nextDueAt,
          notes: req.body.notes,
        },
      });
      return touchpoint;
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.patch<{
    Params: { id: string };
    Body: {
      contactName?: string;
      relationship?: string | null;
      domain?: LifeDomain;
      cadenceDays?: number;
      lastContactedAt?: string | null;
      nextDueAt?: string | null;
      notes?: string | null;
      markContacted?: boolean;
    };
  }>("/life/touchpoints/:id", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const existing = await prisma.relationshipTouchpoint.findUnique({
        where: { id: req.params.id },
      });
      if (!existing) return reply.status(404).send({ error: "Touchpoint not found" });

      let lastContactedAt =
        req.body.lastContactedAt === undefined
          ? undefined
          : req.body.lastContactedAt
            ? new Date(req.body.lastContactedAt)
            : null;
      let nextDueAt =
        req.body.nextDueAt === undefined
          ? undefined
          : req.body.nextDueAt
            ? new Date(req.body.nextDueAt)
            : null;

      if (req.body.markContacted) {
        const contacted = new Date();
        lastContactedAt = contacted;
        const cadence = req.body.cadenceDays ?? existing.cadenceDays;
        nextDueAt = new Date(contacted);
        nextDueAt.setDate(nextDueAt.getDate() + cadence);
      }

      const touchpoint = await prisma.relationshipTouchpoint.update({
        where: { id: req.params.id },
        data: {
          contactName: req.body.contactName,
          relationship: req.body.relationship,
          domain: req.body.domain,
          cadenceDays: req.body.cadenceDays,
          lastContactedAt,
          nextDueAt,
          notes: req.body.notes,
        },
      });
      return touchpoint;
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // Notes
  app.get("/life/notes", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const notes = await prisma.personalNote.findMany({
        orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
      });
      return { notes };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post<{
    Body: {
      title?: string;
      body: string;
      domain?: LifeDomain;
      pinned?: boolean;
    };
  }>("/life/notes", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const body = req.body.body?.trim();
      if (!body) return reply.status(400).send({ error: "body is required" });
      const note = await prisma.personalNote.create({
        data: {
          title: req.body.title?.trim() || null,
          body,
          domain: req.body.domain ?? "PERSONAL",
          pinned: req.body.pinned ?? false,
        },
      });
      return note;
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.patch<{
    Params: { id: string };
    Body: {
      title?: string | null;
      body?: string;
      domain?: LifeDomain;
      pinned?: boolean;
    };
  }>("/life/notes/:id", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const note = await prisma.personalNote.update({
        where: { id: req.params.id },
        data: {
          title: req.body.title,
          body: req.body.body,
          domain: req.body.domain,
          pinned: req.body.pinned,
        },
      });
      return note;
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // Lifestyle metrics
  app.get("/life/metrics", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const metrics = await prisma.lifestyleMetric.findMany({
        orderBy: { recordedAt: "desc" },
        take: 100,
      });
      return { metrics };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post<{
    Body: {
      key: string;
      label?: string;
      value: number;
      unit?: string;
      recordedAt?: string;
      note?: string;
    };
  }>("/life/metrics", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const key = req.body.key?.trim();
      if (!key) return reply.status(400).send({ error: "key is required" });
      if (typeof req.body.value !== "number" || Number.isNaN(req.body.value)) {
        return reply.status(400).send({ error: "value must be a number" });
      }
      const metric = await prisma.lifestyleMetric.create({
        data: {
          key,
          label: req.body.label,
          value: req.body.value,
          unit: req.body.unit,
          recordedAt: req.body.recordedAt ? new Date(req.body.recordedAt) : new Date(),
          note: req.body.note,
        },
      });
      return metric;
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
