import { apiGet, apiPut, type CeoProfile, type UsageMode } from "@/lib/api-client";
import { getActiveProfileId } from "@/lib/session";
import { normalizeUsageMode, showsPersonalSection } from "@/lib/usage-mode";

/** Stable widget ids — catalog + Home layout. */
export type HomeWidgetId =
  | "triage"
  | "heads-up"
  | "confirms"
  | "fristen"
  | "morning-brief"
  | "soul-news"
  | "activity"
  | "finance"
  | "life-habits"
  | "archive-queue"
  | "ollama"
  | "team"
  | "memory"
  | "drive";

export type WidgetSize = "sm" | "md" | "lg";

export type HomeWidgetPlacement = {
  id: HomeWidgetId;
  size: WidgetSize;
};

export type HomeLayout = {
  version: 1;
  widgets: HomeWidgetPlacement[];
};

export type WidgetCatalogEntry = {
  id: HomeWidgetId;
  title: string;
  description: string;
  /** When false, hide from catalog for current usage mode (still removable if present). */
  availableFor: (mode: UsageMode) => boolean;
  defaultSize: WidgetSize;
};

export const WIDGET_CATALOG: WidgetCatalogEntry[] = [
  {
    id: "triage",
    title: "Triage dump",
    description: "Paste or drop something — Staff proposes who should handle it.",
    availableFor: () => true,
    defaultSize: "lg",
  },
  {
    id: "heads-up",
    title: "Heads-up",
    description: "Urgent Fristen and unpaid invoices — navigates only; writes stay confirm-gated.",
    availableFor: () => true,
    defaultSize: "md",
  },
  {
    id: "confirms",
    title: "Needs your confirmation",
    description: "Approve or decline before Drive, ledger, or other writes.",
    availableFor: () => true,
    defaultSize: "md",
  },
  {
    id: "fristen",
    title: "Fristen / deadlines",
    description: "Upcoming dates from archive OCR and legal tasks you track.",
    availableFor: () => true,
    defaultSize: "md",
  },
  {
    id: "morning-brief",
    title: "Morning brief",
    description: "Zurich morning snapshot — regenerate anytime.",
    availableFor: () => true,
    defaultSize: "md",
  },
  {
    id: "soul-news",
    title: "Soul News",
    description: "Reflective sky & weather cards from the Soul News feed.",
    availableFor: () => true,
    defaultSize: "md",
  },
  {
    id: "activity",
    title: "Activity recent",
    description: "Latest confirms, archive writes, and triage in the audit trail.",
    availableFor: () => true,
    defaultSize: "sm",
  },
  {
    id: "finance",
    title: "Finance snapshot",
    description: "Spent vs limits this month — only when you have budget data.",
    availableFor: () => true,
    defaultSize: "md",
  },
  {
    id: "life-habits",
    title: "Life habits today",
    description: "Today’s habit check-ins from Life.",
    availableFor: (mode) => showsPersonalSection(mode),
    defaultSize: "md",
  },
  {
    id: "archive-queue",
    title: "Archive queue",
    description: "Ingest lane: rasterize → OCR → split → await confirm, with vision lock.",
    availableFor: () => true,
    defaultSize: "md",
  },
  {
    id: "ollama",
    title: "Ollama / brains",
    description: "Local model reachability and busy state.",
    availableFor: () => true,
    defaultSize: "sm",
  },
  {
    id: "team",
    title: "Team quick-pick",
    description: "Jump straight into a specialist chat.",
    availableFor: () => true,
    defaultSize: "md",
  },
  {
    id: "memory",
    title: "Memory facts",
    description: "Recent facts specialists can use — optional strip.",
    availableFor: () => true,
    defaultSize: "sm",
  },
  {
    id: "drive",
    title: "Drive link status",
    description: "Whether Google Drive archive is linked for this profile.",
    availableFor: () => true,
    defaultSize: "sm",
  },
];

const CATALOG_BY_ID = new Map(WIDGET_CATALOG.map((e) => [e.id, e]));

export function catalogEntry(id: HomeWidgetId): WidgetCatalogEntry | undefined {
  return CATALOG_BY_ID.get(id);
}

export function defaultHomeLayout(mode: UsageMode): HomeLayout {
  const m = normalizeUsageMode(mode);
  if (m === "BUSINESS") {
    return {
      version: 1,
      widgets: [
        { id: "triage", size: "lg" },
        { id: "heads-up", size: "md" },
        { id: "confirms", size: "md" },
        { id: "fristen", size: "md" },
        { id: "finance", size: "md" },
        { id: "morning-brief", size: "md" },
        { id: "activity", size: "sm" },
        { id: "team", size: "md" },
        { id: "archive-queue", size: "sm" },
        { id: "ollama", size: "sm" },
        { id: "drive", size: "sm" },
      ],
    };
  }
  if (m === "BOTH") {
    return {
      version: 1,
      widgets: [
        { id: "triage", size: "lg" },
        { id: "heads-up", size: "md" },
        { id: "confirms", size: "md" },
        { id: "fristen", size: "md" },
        { id: "life-habits", size: "md" },
        { id: "finance", size: "md" },
        { id: "morning-brief", size: "md" },
        { id: "activity", size: "sm" },
        { id: "team", size: "md" },
        { id: "archive-queue", size: "sm" },
        { id: "drive", size: "sm" },
      ],
    };
  }
  // PERSONAL
  return {
    version: 1,
    widgets: [
      { id: "triage", size: "lg" },
      { id: "heads-up", size: "md" },
      { id: "confirms", size: "md" },
      { id: "fristen", size: "md" },
      { id: "life-habits", size: "md" },
      { id: "morning-brief", size: "md" },
      { id: "activity", size: "sm" },
      { id: "team", size: "md" },
      { id: "archive-queue", size: "sm" },
      { id: "ollama", size: "sm" },
      { id: "drive", size: "sm" },
    ],
  };
}

const ALL_IDS = new Set(WIDGET_CATALOG.map((e) => e.id));

export function normalizeHomeLayout(raw: unknown, mode: UsageMode): HomeLayout {
  const fallback = defaultHomeLayout(mode);
  if (!raw || typeof raw !== "object") return fallback;
  const widgetsRaw = (raw as { widgets?: unknown }).widgets;
  if (!Array.isArray(widgetsRaw)) return fallback;
  const seen = new Set<HomeWidgetId>();
  const widgets: HomeWidgetPlacement[] = [];
  for (const item of widgetsRaw) {
    if (!item || typeof item !== "object") continue;
    const id = (item as { id?: unknown }).id;
    if (typeof id !== "string" || !ALL_IDS.has(id as HomeWidgetId) || seen.has(id as HomeWidgetId)) {
      continue;
    }
    const sizeRaw = (item as { size?: unknown }).size;
    const size: WidgetSize =
      sizeRaw === "sm" || sizeRaw === "md" || sizeRaw === "lg"
        ? sizeRaw
        : (CATALOG_BY_ID.get(id as HomeWidgetId)?.defaultSize ?? "md");
    seen.add(id as HomeWidgetId);
    widgets.push({ id: id as HomeWidgetId, size });
  }
  if (widgets.length === 0) return fallback;
  return { version: 1, widgets };
}

function storageKey(profileId: string): string {
  return `personai.home.layout.v1.${profileId}`;
}

export function readLocalHomeLayout(profileId: string | null, mode: UsageMode): HomeLayout {
  if (typeof window === "undefined" || !profileId) return defaultHomeLayout(mode);
  try {
    const raw = localStorage.getItem(storageKey(profileId));
    if (!raw) return defaultHomeLayout(mode);
    return normalizeHomeLayout(JSON.parse(raw) as unknown, mode);
  } catch {
    return defaultHomeLayout(mode);
  }
}

export function writeLocalHomeLayout(profileId: string | null, layout: HomeLayout): void {
  if (typeof window === "undefined" || !profileId) return;
  localStorage.setItem(storageKey(profileId), JSON.stringify(layout));
}

/** Persist locally and best-effort sync to CeoProfile.dashboardLayout. */
export async function persistHomeLayout(layout: HomeLayout): Promise<void> {
  const profileId = getActiveProfileId();
  writeLocalHomeLayout(profileId, layout);
  try {
    await apiPut<CeoProfile>(
      "/ceo-profile",
      { dashboardLayout: JSON.stringify(layout) },
      { silent: true },
    );
  } catch {
    // Local layout still wins; API sync is optional.
  }
}

/** Load layout: localStorage first, then API if local empty / missing. */
export async function loadHomeLayout(mode: UsageMode): Promise<HomeLayout> {
  const profileId = getActiveProfileId();
  if (typeof window !== "undefined" && profileId) {
    const localRaw = localStorage.getItem(storageKey(profileId));
    if (localRaw) {
      try {
        return normalizeHomeLayout(JSON.parse(localRaw) as unknown, mode);
      } catch {
        /* fall through */
      }
    }
  }
  try {
    const profile = await apiGet<CeoProfile>("/ceo-profile", { silent: true });
    if (profile.dashboardLayout) {
      const parsed =
        typeof profile.dashboardLayout === "string"
          ? (JSON.parse(profile.dashboardLayout) as unknown)
          : profile.dashboardLayout;
      const layout = normalizeHomeLayout(parsed, normalizeUsageMode(profile.usageMode ?? mode));
      writeLocalHomeLayout(profileId, layout);
      return layout;
    }
  } catch {
    /* defaults */
  }
  return defaultHomeLayout(mode);
}

export function moveWidget(
  layout: HomeLayout,
  id: HomeWidgetId,
  direction: "up" | "down",
): HomeLayout {
  const idx = layout.widgets.findIndex((w) => w.id === id);
  if (idx < 0) return layout;
  const swap = direction === "up" ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= layout.widgets.length) return layout;
  const next = [...layout.widgets];
  const a = next[idx]!;
  next[idx] = next[swap]!;
  next[swap] = a;
  return { version: 1, widgets: next };
}

export function addWidget(layout: HomeLayout, id: HomeWidgetId): HomeLayout {
  if (layout.widgets.some((w) => w.id === id)) return layout;
  const entry = CATALOG_BY_ID.get(id);
  if (!entry) return layout;
  return {
    version: 1,
    widgets: [...layout.widgets, { id, size: entry.defaultSize }],
  };
}

export function removeWidget(layout: HomeLayout, id: HomeWidgetId): HomeLayout {
  return { version: 1, widgets: layout.widgets.filter((w) => w.id !== id) };
}

export function setWidgetSize(
  layout: HomeLayout,
  id: HomeWidgetId,
  size: WidgetSize,
): HomeLayout {
  return {
    version: 1,
    widgets: layout.widgets.map((w) => (w.id === id ? { ...w, size } : w)),
  };
}
