import { useCallback, useEffect, useState } from "react";
import { apiGet, type CeoProfile, type UsageMode } from "@/lib/api-client";

export type { UsageMode };

export const DEFAULT_USAGE_MODE: UsageMode = "PERSONAL";

export function normalizeUsageMode(value: unknown): UsageMode {
  if (value === "BUSINESS" || value === "BOTH" || value === "PERSONAL") return value;
  return DEFAULT_USAGE_MODE;
}

/** Life / medical lead; business modules available but not primary. */
export function isPersonalFirst(mode: UsageMode): boolean {
  return mode === "PERSONAL" || mode === "BOTH";
}

export function showsBusinessSection(mode: UsageMode): boolean {
  return mode === "BUSINESS" || mode === "BOTH";
}

export function showsPersonalSection(mode: UsageMode): boolean {
  return mode === "PERSONAL" || mode === "BOTH";
}

export const USAGE_MODE_OPTIONS: Array<{
  value: UsageMode;
  label: string;
  description: string;
}> = [
  {
    value: "PERSONAL",
    label: "Personal",
    description: "Life, habits, and health first. Finance stays available without company defaults.",
  },
  {
    value: "BUSINESS",
    label: "Business",
    description: "Finance and legal up front. Life stays available when you need it.",
  },
  {
    value: "BOTH",
    label: "Both",
    description: "Personal-first Home layout, with business modules ready — no company assumed.",
  },
];

type NavItem = { href: string; label: string; icon: unknown };

/** Desktop primary nav order by usage mode. */
export function orderPrimaryNav<T extends NavItem>(items: T[], mode: UsageMode): T[] {
  const byHref = new Map(items.map((i) => [i.href, i]));
  const pick = (hrefs: string[]) =>
    hrefs.map((h) => byHref.get(h)).filter((x): x is T => Boolean(x));

  if (mode === "BUSINESS") {
    return pick([
      "/dashboard/",
      "/finance/",
      "/legal/",
      "/team/",
      "/ingest/",
      "/life/",
      "/medical/",
    ]);
  }
  // PERSONAL and BOTH: personal-first
  return pick([
    "/dashboard/",
    "/life/",
    "/medical/",
    "/team/",
    "/finance/",
    "/legal/",
    "/ingest/",
  ]);
}

/** Mobile bottom nav order (subset). */
export function orderMobileNav<T extends NavItem>(items: T[], mode: UsageMode): T[] {
  const byHref = new Map(items.map((i) => [i.href, i]));
  const pick = (hrefs: string[]) =>
    hrefs.map((h) => byHref.get(h)).filter((x): x is T => Boolean(x));

  if (mode === "BUSINESS") {
    return pick([
      "/dashboard/",
      "/finance/",
      "/team/",
      "/ingest/",
      "/life/",
      "/settings/",
    ]);
  }
  return pick([
    "/dashboard/",
    "/life/",
    "/team/",
    "/finance/",
    "/ingest/",
    "/settings/",
  ]);
}

export function useUsageMode(): {
  usageMode: UsageMode;
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const [usageMode, setUsageMode] = useState<UsageMode>(DEFAULT_USAGE_MODE);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const profile = await apiGet<CeoProfile>("/ceo-profile");
      setUsageMode(normalizeUsageMode(profile.usageMode));
    } catch {
      setUsageMode(DEFAULT_USAGE_MODE);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onChanged = () => {
      void refresh();
    };
    window.addEventListener("personai:usage-mode-changed", onChanged);
    window.addEventListener("personai:profile-changed", onChanged);
    return () => {
      window.removeEventListener("personai:usage-mode-changed", onChanged);
      window.removeEventListener("personai:profile-changed", onChanged);
    };
  }, [refresh]);

  return { usageMode, loading, refresh };
}

export function notifyUsageModeChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("personai:usage-mode-changed"));
}
