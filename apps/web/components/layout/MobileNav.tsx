"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Upload, Wallet, Scale, HeartPulse } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/ingest", label: "Ingest", icon: Upload },
  { href: "/finance", label: "Finance", icon: Wallet },
  { href: "/legal", label: "Legal", icon: Scale },
  { href: "/medical", label: "Medical", icon: HeartPulse },
];

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      className="glass-panel fixed inset-x-0 bottom-0 z-40 border-t border-border md:hidden"
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
                  "flex flex-col items-center gap-0.5 px-1 py-2 text-[10px] font-medium",
                  active ? "text-teal-300" : "text-muted-foreground",
                )}
              >
                <Icon className={cn("h-5 w-5", active && "text-teal-400")} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
