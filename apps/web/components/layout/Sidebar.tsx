"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Sparkles,
  Upload,
  Wallet,
  Scale,
  HeartPulse,
  Settings,
  Users,
  Activity,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { OllamaStatusIndicator } from "@/components/shared/OllamaStatusIndicator";
import { orderPrimaryNav, useUsageMode } from "@/lib/usage-mode";

const primaryNav = [
  { href: "/dashboard/", label: "Home", icon: LayoutDashboard },
  { href: "/life/", label: "Life", icon: Sparkles },
  { href: "/team/", label: "Team", icon: Users },
  { href: "/ingest/", label: "Archive", icon: Upload },
  { href: "/finance/", label: "Finance", icon: Wallet },
  { href: "/legal/", label: "Legal", icon: Scale },
  { href: "/medical/", label: "Medical", icon: HeartPulse },
  { href: "/activity/", label: "Activity", icon: Activity },
];

const settingsItem = { href: "/settings/", label: "Settings", icon: Settings };

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

function NavLink({
  href,
  label,
  icon: Icon,
  collapsed,
}: {
  href: string;
  label: string;
  icon: typeof Settings;
  collapsed: boolean;
}) {
  const pathname = usePathname();
  const base = href.replace(/\/+$/, "");
  const active = pathname === href || pathname === base || pathname.startsWith(`${base}/`);

  return (
    <Link
      href={href}
      className={cn(
        "pressable flex min-h-10 items-center gap-3 rounded-full px-3.5 py-2.5 text-sm font-medium transition-colors duration-md ease-md",
        active
          ? "bg-secondary text-secondary-foreground shadow-elev-1"
          : "text-muted-foreground hover:bg-surface-container-high hover:text-foreground",
        collapsed && "min-h-11 justify-center rounded-2xl px-0 py-3",
      )}
      title={collapsed ? label : undefined}
    >
      <Icon className={cn("h-5 w-5 shrink-0", active && "text-primary")} />
      {!collapsed && <span className="min-w-0 truncate">{label}</span>}
    </Link>
  );
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { usageMode } = useUsageMode();
  const nav = orderPrimaryNav(primaryNav, usageMode);

  return (
    <aside
      className={cn(
        "surface-panel flex h-full flex-col border-r transition-[width] duration-md-slow ease-md",
        collapsed ? "w-[var(--nav-rail-width)]" : "w-[var(--sidebar-width)]",
      )}
    >
      <div className="flex h-[var(--header-height)] items-center justify-between border-b border-border/60 px-3">
        {!collapsed && (
          <Link href="/dashboard/" className="group flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-container-high text-primary shadow-elev-1">
              <span className="font-display text-base leading-none">Ai</span>
            </div>
            <span className="truncate font-display text-[17px] tracking-tight">PersonAI</span>
          </Link>
        )}
        <Button variant="ghost" size="icon" onClick={onToggle} className="h-9 w-9 shrink-0">
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>

      <nav className={cn("flex flex-1 flex-col gap-1 overflow-y-auto p-2.5", collapsed && "px-1.5")}>
        <div className="space-y-1">
          {nav.map((item) => (
            <NavLink key={item.href} {...item} collapsed={collapsed} />
          ))}
        </div>

        <div className="mt-auto space-y-1 border-t border-border/50 pt-3">
          {!collapsed && (
            <p className="px-3.5 pb-1 text-xs font-semibold uppercase tracking-[0.06em] text-foreground/65">
              Account
            </p>
          )}
          <NavLink {...settingsItem} collapsed={collapsed} />
        </div>
      </nav>

      <div className={cn("border-t border-border/60 p-3", collapsed && "px-1.5")}>
        <OllamaStatusIndicator className={collapsed ? "justify-center" : undefined} />
      </div>
    </aside>
  );
}
