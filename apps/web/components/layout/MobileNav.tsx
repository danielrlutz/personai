"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, Upload, Wallet, HeartPulse } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/team", label: "Team", icon: Users },
  { href: "/ingest", label: "Archive", icon: Upload },
  { href: "/finance", label: "Finance", icon: Wallet },
  { href: "/medical", label: "Medical", icon: HeartPulse },
];

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      className="surface-panel fixed inset-x-0 bottom-0 z-40 border-t md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="flex items-stretch justify-around px-1 pt-1">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                className={cn(
                  "flex min-w-0 flex-col items-center gap-1 px-0.5 py-1.5 md-label-medium transition-colors duration-md ease-md",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex h-8 w-12 items-center justify-center rounded-full transition-colors duration-md ease-md sm:w-14",
                    active && "bg-secondary",
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
