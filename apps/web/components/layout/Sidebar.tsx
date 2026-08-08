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
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { OllamaStatusIndicator } from "@/components/shared/OllamaStatusIndicator";

const navItems = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/life", label: "Life", icon: Sparkles },
  { href: "/team", label: "Team", icon: Users },
  { href: "/ingest", label: "Archive", icon: Upload },
  { href: "/finance", label: "Finance", icon: Wallet },
  { href: "/legal", label: "Legal", icon: Scale },
  { href: "/medical", label: "Medical", icon: HeartPulse },
  { href: "/settings", label: "Settings", icon: Settings },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "surface-panel flex h-full flex-col border-r transition-[width] duration-md ease-md",
        collapsed ? "w-[var(--nav-rail-width)]" : "w-[var(--sidebar-width)]",
      )}
    >
      <div className="flex h-[var(--header-height)] items-center justify-between border-b border-border/80 px-3">
        {!collapsed && (
          <Link href="/dashboard" className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <span className="text-sm font-medium">P</span>
            </div>
            <span className="md-title-medium truncate">PersonAI</span>
          </Link>
        )}
        <Button variant="ghost" size="icon" onClick={onToggle} className="shrink-0 h-9 w-9">
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>

      <nav className={cn("flex-1 space-y-1 p-2", collapsed && "px-1.5")}>
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-full px-3 py-2.5 md-label-large transition-colors duration-md ease-md",
                active
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:bg-surface-container-high hover:text-foreground",
                collapsed && "justify-center px-0 py-3 rounded-2xl",
              )}
              title={collapsed ? label : undefined}
            >
              <Icon className={cn("h-5 w-5 shrink-0", active && "text-primary")} />
              {!collapsed && <span>{label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className={cn("border-t border-border/80 p-3", collapsed && "px-1.5")}>
        <OllamaStatusIndicator className={collapsed ? "justify-center" : undefined} />
      </div>
    </aside>
  );
}
