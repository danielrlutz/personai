import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { config } from "../config.js";
import { getProfileId, sendError, withPrisma } from "./helpers.js";

export type SoulNewsItem = {
  id: string;
  kind: string;
  title: string;
  body: string;
  tags: string[];
  sources: string[];
};

export type SoulNewsFeed = {
  ok: boolean;
  generatedAt: string | null;
  nextRefreshAt: string | null;
  items: SoulNewsItem[];
  error?: string;
};

export type SoulNewsBriefSection = {
  id: string;
  title: string;
  body: string;
  citations?: string[];
};

export type SoulNewsBrief = {
  ok: boolean;
  profile: string;
  fromCache: boolean;
  generatedAt: string | null;
  meta: {
    cachedAt: string | null;
    expiresAt: string | null;
    model: string | null;
    stale: boolean;
    ollamaAvailable: boolean;
  };
  brief: {
    headline: string;
    lede: string;
    sections: SoulNewsBriefSection[];
    watchlist: string[];
    actions: string[];
  } | null;
  error?: string;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && Boolean(v.trim()));
}

/** Prefer DE (Zurich desk), then EN, then flat title/body contract. */
function localizedCopy(obj: Record<string, unknown>): { title: string | null; body: string | null } {
  const de = obj.de && typeof obj.de === "object" ? (obj.de as Record<string, unknown>) : null;
  const en = obj.en && typeof obj.en === "object" ? (obj.en as Record<string, unknown>) : null;
  const title = asString(de?.title) ?? asString(en?.title) ?? asString(obj.title);
  const body = asString(de?.body) ?? asString(en?.body) ?? asString(obj.body);
  return { title, body };
}

function normalizeItem(raw: unknown, index: number, feedSources: string[]): SoulNewsItem | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const { title, body } = localizedCopy(obj);
  if (!title && !body) return null;

  const tags = asStringArray(obj.tags);
  const severity = asString(obj.severity);
  if (severity && !tags.includes(severity)) tags.unshift(severity);

  const itemSources = asStringArray(obj.sources);
  return {
    id: asString(obj.id) ?? `item-${index}`,
    kind: asString(obj.kind) ?? "note",
    title: title ?? "Untitled",
    body: body ?? "",
    tags,
    sources: itemSources.length > 0 ? itemSources : feedSources,
  };
}

function normalizeFeed(raw: unknown): SoulNewsFeed {
  if (!raw || typeof raw !== "object") {
    return {
      ok: false,
      generatedAt: null,
      nextRefreshAt: null,
      items: [],
      error: "Soul News returned an unexpected payload",
    };
  }
  const obj = raw as Record<string, unknown>;
  const feedSources = asStringArray(obj.sources);
  const itemsRaw = Array.isArray(obj.items) ? obj.items : [];
  const items = itemsRaw
    .map((item, index) => normalizeItem(item, index, feedSources))
    .filter((item): item is SoulNewsItem => item !== null);

  return {
    ok: true,
    generatedAt: asString(obj.generatedAt),
    nextRefreshAt: asString(obj.nextRefreshAt) ?? asString(obj.nextCronHint),
    items,
  };
}

function soulNewsHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
  if (config.soulNewsContextToken) {
    headers["X-Soul-News-Context-Token"] = config.soulNewsContextToken;
  }
  return headers;
}

async function fetchSoulNews(path: string, init?: RequestInit): Promise<Response> {
  const base = config.soulNewsUrl.replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init?.method === "POST" ? 130_000 : 8000);
  try {
    return await fetch(`${base}${path}`, {
      ...init,
      headers: { ...soulNewsHeaders(), ...(init?.headers as Record<string, string> | undefined) },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSoulNewsFeed(): Promise<SoulNewsFeed> {
  try {
    const res = await fetchSoulNews("/v1/feed");
    if (!res.ok) {
      return {
        ok: false,
        generatedAt: null,
        nextRefreshAt: null,
        items: [],
        error: `Soul News unavailable (${res.status})`,
      };
    }
    const json = (await res.json()) as unknown;
    return normalizeFeed(json);
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      generatedAt: null,
      nextRefreshAt: null,
      items: [],
      error: aborted ? "Soul News timed out" : "Soul News is offline",
    };
  }
}

async function buildDeskContext(prisma: PrismaClient, profileId: string) {
  const now = new Date();
  const horizon = new Date(now.getTime() + 36 * 60 * 60 * 1000);

  const [tasks, docs, openTasks] = await Promise.all([
    prisma.legalTask.findMany({
      where: {
        status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] },
        dueDate: { not: null, lte: horizon },
      },
      orderBy: { dueDate: "asc" },
      take: 6,
    }),
    prisma.document.findMany({
      where: { deadline: { not: null, lte: horizon } },
      orderBy: { deadline: "asc" },
      take: 4,
    }),
    prisma.legalTask.findMany({
      where: { status: { in: ["TODO", "IN_PROGRESS"] } },
      orderBy: { updatedAt: "desc" },
      take: 4,
    }),
  ]);

  const fristen = [
    ...tasks.map((t) => ({
      title: t.title,
      dueDate: t.dueDate?.toISOString() ?? null,
      overdue: Boolean(t.dueDate && t.dueDate < now),
      kind: "legal_task" as const,
    })),
    ...docs.map((d) => ({
      title: (d.archiveName || d.filename).replace(/\bBILL\b/g, "Invoice"),
      dueDate: d.deadline?.toISOString() ?? null,
      overdue: Boolean(d.deadline && d.deadline < now),
      kind: "document" as const,
    })),
  ].slice(0, 6);

  return {
    profileId,
    profileHint: "Zurich desk · DE preferred",
    fristen,
    pendingTasks: openTasks.map((t) => ({
      title: t.title,
      dueDate: t.dueDate?.toISOString() ?? null,
      kind: t.type,
    })),
  };
}

function normalizeBrief(raw: unknown, profileId: string): SoulNewsBrief {
  if (!raw || typeof raw !== "object") {
    return {
      ok: false,
      profile: profileId,
      fromCache: false,
      generatedAt: null,
      meta: { cachedAt: null, expiresAt: null, model: null, stale: true, ollamaAvailable: false },
      brief: null,
      error: "Unexpected brief payload",
    };
  }
  const obj = raw as Record<string, unknown>;
  const metaRaw = obj.meta && typeof obj.meta === "object" ? (obj.meta as Record<string, unknown>) : {};
  const briefRaw = obj.brief && typeof obj.brief === "object" ? (obj.brief as Record<string, unknown>) : null;

  const sectionsRaw = briefRaw && Array.isArray(briefRaw.sections) ? briefRaw.sections : [];
  const sections = sectionsRaw
    .filter((s) => s && typeof s === "object")
    .map((s) => {
      const sec = s as Record<string, unknown>;
      return {
        id: asString(sec.id) ?? "section",
        title: asString(sec.title) ?? "",
        body: asString(sec.body) ?? "",
        citations: asStringArray(sec.citations),
      };
    });

  return {
    ok: true,
    profile: asString(obj.profile) ?? profileId,
    fromCache: Boolean(obj.fromCache),
    generatedAt: asString(metaRaw.snapshotGeneratedAt) ?? asString(obj.generatedAt),
    meta: {
      cachedAt: asString(metaRaw.cachedAt),
      expiresAt: asString(metaRaw.expiresAt),
      model: asString(metaRaw.model) ?? asString(briefRaw?.model),
      stale: Boolean(metaRaw.stale),
      ollamaAvailable: Boolean(metaRaw.ollamaAvailable),
    },
    brief: briefRaw
      ? {
          headline: asString(briefRaw.headline) ?? "Today's brief",
          lede: asString(briefRaw.lede) ?? "",
          sections,
          watchlist: asStringArray(briefRaw.watchlist),
          actions: asStringArray(briefRaw.actions),
        }
      : null,
  };
}

async function fetchSoulNewsBrief(req: FastifyRequest, force = false): Promise<SoulNewsBrief> {
  let profileId = "default";
  try {
    profileId = getProfileId(req);
  } catch {
    profileId = "default";
  }

  try {
    let context: Awaited<ReturnType<typeof buildDeskContext>> | null = null;
    try {
      const { prisma, profileId: pid } = await withPrisma(req);
      profileId = pid;
      context = await buildDeskContext(prisma, profileId);
    } catch {
      // desk context optional when profile/db unavailable
    }

    if (context) {
      await fetchSoulNews("/v1/brief/context", {
        method: "POST",
        body: JSON.stringify({ profile: profileId, context }),
      }).catch(() => undefined);
    }

    const res = force
      ? await fetchSoulNews("/v1/brief/compose", {
          method: "POST",
          body: JSON.stringify({ profile: profileId, context, force: true }),
        })
      : await fetchSoulNews(`/v1/brief?profile=${encodeURIComponent(profileId)}`);

    if (!res.ok) {
      return {
        ok: false,
        profile: profileId,
        fromCache: false,
        generatedAt: null,
        meta: { cachedAt: null, expiresAt: null, model: null, stale: true, ollamaAvailable: false },
        brief: null,
        error: `Soul News brief unavailable (${res.status})`,
      };
    }

    const json = (await res.json()) as unknown;
    return normalizeBrief(json, profileId);
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      profile: profileId,
      fromCache: false,
      generatedAt: null,
      meta: { cachedAt: null, expiresAt: null, model: null, stale: true, ollamaAvailable: false },
      brief: null,
      error: aborted ? "Soul News brief timed out" : "Soul News brief offline",
    };
  }
}

export async function registerSoulNewsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/integrations/soul-news/feed", async () => fetchSoulNewsFeed());

  app.get("/integrations/soul-news/brief", async (req) => fetchSoulNewsBrief(req, false));

  app.post("/integrations/soul-news/brief/refresh", async (req, reply) => {
    try {
      return await fetchSoulNewsBrief(req, true);
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
