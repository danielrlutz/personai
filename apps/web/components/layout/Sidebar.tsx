"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Upload,
  Wallet,
  Scale,
  HeartPulse,
  Settings,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { OllamaStatusIndicator } from "@/components/shared/OllamaStatusIndicator";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/ingest", label: "Ingest", icon: Upload },
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
        "glass-panel flex h-full flex-col border-r border-border transition-all duration-300",
        collapsed ? "w-[4.5rem]" : "w-[var(--sidebar-width)]",
      )}
    >
      <div className="flex h-[var(--header-height)] items-center justify-between border-b border-border px-4">
        {!collapsed && (
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-500/20">
              <span className="text-sm font-bold text-teal-400">P</span>
            </div>
            <span className="font-semibold tracking-tight">
              Person<span className="text-teal-400">AI</span>
            </span>
          </Link>
        )}
        <Button variant="ghost" size="icon" onClick={onToggle} className="shrink-0">
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-teal-500/15 text-teal-300"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                collapsed && "justify-center px-2",
              )}
              title={collapsed ? label : undefined}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span>{label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className={cn("border-t border-border p-4", collapsed && "px-2")}>
        <OllamaStatusIndicator className={collapsed ? "justify-center" : undefined} />
      </div>
    </aside>
  );
}
