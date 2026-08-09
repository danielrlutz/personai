"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Sparkles,
  Users,
  Upload,
  Wallet,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { orderMobileNav, useUsageMode } from "@/lib/usage-mode";

/** Primary destinations — Settings is first-class. Medical stays in desktop sidebar + ⌘K. */
const items = [
  { href: "/dashboard/", label: "Home", icon: LayoutDashboard },
  { href: "/life/", label: "Life", icon: Sparkles },
  { href: "/team/", label: "Team", icon: Users },
  { href: "/ingest/", label: "Archive", icon: Upload },
  { href: "/finance/", label: "Finance", icon: Wallet },
  { href: "/settings/", label: "Settings", icon: Settings },
];

export function MobileNav() {
  const pathname = usePathname();
  const { usageMode } = useUsageMode();
  const nav = orderMobileNav(items, usageMode);

  return (
    <nav
      className="surface-panel fixed inset-x-0 bottom-0 z-40 border-t shadow-elev-2 md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="flex items-stretch justify-around px-0.5 pt-1.5">
        {nav.map(({ href, label, icon: Icon }) => {
          const base = href.replace(/\/+$/, "");
          const active = pathname === href || pathname === base || pathname.startsWith(`${base}/`);
          return (
            <li key={href} className="min-w-0 flex-1">
              <Link
                href={href}
                className={cn(
                  "pressable flex min-w-0 flex-col items-center gap-0.5 px-0.5 py-1.5 text-[10px] font-medium transition-colors duration-md ease-md sm:text-[11px]",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex h-8 w-11 items-center justify-center rounded-full transition-colors duration-md ease-md sm:w-12",
                    active && "bg-secondary shadow-elev-1",
                  )}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <span className="max-w-full truncate px-0.5">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
