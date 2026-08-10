import type { FastifyInstance } from "fastify";
import { config } from "../config.js";

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

async function fetchSoulNewsFeed(): Promise<SoulNewsFeed> {
  const base = config.soulNewsUrl.replace(/\/$/, "");
  const url = `${base}/v1/feed`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
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
  } finally {
    clearTimeout(timer);
  }
}

export async function registerSoulNewsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/integrations/soul-news/feed", async () => fetchSoulNewsFeed());
}
