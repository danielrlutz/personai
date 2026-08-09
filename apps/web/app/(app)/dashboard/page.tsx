"use client";

import { HomeDashboard } from "@/components/home/HomeDashboard";

/**
 * Home = customizable triage composition (Product) — not a KPI card dashboard (Design).
 * Layout is per-profile (localStorage + optional CeoProfile sync).
 */
export default function DashboardPage() {
  return <HomeDashboard />;
}
