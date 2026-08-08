"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { ProfileSwitcher } from "./ProfileSwitcher";
import { MobileNav } from "./MobileNav";
import { getStoredProfileId } from "@/lib/platform";
import { setProfileId } from "@/lib/api-client";
import { cn } from "@/lib/utils";

const commandItems = [
  { label: "Dashboard", href: "/dashboard", keys: "G D" },
  { label: "Ingest documents", href: "/ingest", keys: "G I" },
  { label: "Finance overview", href: "/finance", keys: "G F" },
  { label: "Transactions", href: "/finance/transactions", keys: "G T" },
  { label: "Advisor chat", href: "/finance/advisor", keys: "G A" },
  { label: "Legal tasks", href: "/legal", keys: "G L" },
  { label: "Medical log", href: "/medical", keys: "G M" },
  { label: "Settings", href: "/settings", keys: "G S" },
  { label: "Switch profile", href: "/profiles", keys: "G P" },
];

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const profileId = getStoredProfileId();
    if (!profileId) {
      router.replace("/profiles");
      return;
    }
    setProfileId(profileId);
    setReady(true);
  }, [router]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if (e.key === "Escape") setPaletteOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const filtered = commandItems.filter((item) =>
    item.label.toLowerCase().includes(query.toLowerCase()),
  );

  const navigate = useCallback(
    (href: string) => {
      setPaletteOpen(false);
      setQuery("");
      router.push(href);
    },
    [router],
  );

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden pt-[env(safe-area-inset-top)]">
      <div className="hidden h-full shrink-0 md:block">
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="glass-panel flex h-[var(--header-height)] shrink-0 items-center justify-between border-b border-border px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-500/20 md:hidden">
              <span className="text-sm font-bold text-teal-400">P</span>
            </div>
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
            >
              <Command className="h-4 w-4" />
              <span className="hidden sm:inline">Command palette</span>
              <kbd className="hidden rounded border border-border bg-background px-1.5 py-0.5 text-[10px] sm:inline">
                ⌘K
              </kbd>
            </button>
          </div>
          <div className="w-40 sm:w-48">
            <ProfileSwitcher />
          </div>
        </header>

        <main
          className={cn(
            "flex-1 overflow-y-auto p-4 sm:p-6",
            "pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-6",
          )}
        >
          {children}
        </main>
      </div>

      <MobileNav />

      {paletteOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={() => setPaletteOpen(false)} />
          <div className="fixed left-1/2 top-[20%] z-50 w-full max-w-lg -translate-x-1/2 animate-in rounded-xl border border-border bg-zinc-900 shadow-2xl">
            <div className="border-b border-border p-4">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search commands..."
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <ul className="max-h-72 overflow-y-auto p-2">
              {filtered.map((item) => (
                <li key={item.href}>
                  <button
                    type="button"
                    onClick={() => navigate(item.href)}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm hover:bg-muted/50"
                  >
                    <span>{item.label}</span>
                    <span className="text-xs text-muted-foreground">{item.keys}</span>
                  </button>
                </li>
              ))}
              {filtered.length === 0 && (
                <li className="px-3 py-8 text-center text-sm text-muted-foreground">No results</li>
              )}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

export { CommandPalette } from "./CommandPalette";
