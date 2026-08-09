"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { ProfileSwitcher } from "./ProfileSwitcher";
import { MobileNav } from "./MobileNav";
import { OutboxBootstrap } from "@/components/outbox/OutboxBootstrap";
import { DriveLinkBanner } from "@/components/drive/DriveLinkBanner";
import { setProfileId, setSessionToken, getSessionToken } from "@/lib/api-client";
import { logoutToProfiles, requireProfile } from "@/lib/session";
import { getStoredSessionToken } from "@/lib/platform";
import { cn } from "@/lib/utils";

const commandItems = [
  { label: "Home / triage", href: "/dashboard/", keys: "G D" },
  { label: "Activity audit", href: "/activity/", keys: "G Y" },
  { label: "Life / Personal", href: "/life/", keys: "G E" },
  { label: "Pocket team", href: "/team/", keys: "G T" },
  { label: "Finance overview", href: "/finance/", keys: "G F" },
  { label: "Transactions", href: "/finance/transactions/", keys: "G X" },
  { label: "Ask finance", href: "/team/?specialist=cfo", keys: "G C" },
  { label: "Archive documents", href: "/ingest/", keys: "G A" },
  { label: "Settings", href: "/settings/", keys: "G S" },
  { label: "Legal tasks (advanced)", href: "/legal/", keys: "G L" },
  { label: "Medical log (advanced)", href: "/medical/", keys: "G M" },
  { label: "Setup wizard (advanced)", href: "/setup/", keys: "G W" },
  { label: "Switch profile", href: "__logout__", keys: "G P" },
];

interface AppShellProps {
  children: React.ReactNode;
}

type Gate = "pending" | "allowed" | "redirecting";

function readInitialGate(): Gate {
  if (typeof window === "undefined") return "pending";
  return requireProfile() ? "allowed" : "pending";
}

export function AppShell({ children }: AppShellProps) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [gate, setGate] = useState<Gate>(readInitialGate);

  useLayoutEffect(() => {
    const profileId = requireProfile();
    const token = getStoredSessionToken();
    if (!profileId || !token) {
      setGate("redirecting");
      router.replace("/profiles/");
      return;
    }
    setProfileId(profileId);
    setSessionToken(token);
    setGate("allowed");

    const onProfileChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ profileId: string | null }>).detail;
      if (!detail?.profileId || !getSessionToken()) {
        setGate("redirecting");
        router.replace("/profiles/");
      }
    };
    window.addEventListener("personai:profile-changed", onProfileChanged);
    return () => window.removeEventListener("personai:profile-changed", onProfileChanged);
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
      if (href === "__logout__") {
        logoutToProfiles();
        return;
      }
      router.push(href);
    },
    [router],
  );

  // Show shell chrome immediately; only gate main content (and redirect without chrome flash).
  if (gate === "redirecting") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="app-atmosphere flex h-dvh max-h-dvh overflow-hidden bg-background pt-[env(safe-area-inset-top)]">
      <div className="relative z-[1] hidden h-full shrink-0 md:block">
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      </div>

      <div className="relative z-[1] flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="surface-panel flex h-[var(--header-height)] shrink-0 items-center justify-between gap-2.5 border-b px-3 sm:gap-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-container-high text-primary md:hidden">
              <span className="font-display text-base leading-none">Ai</span>
            </div>
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="pressable flex h-10 min-w-0 max-w-full items-center gap-2 rounded-full border border-border/70 bg-surface-container/90 px-3 text-sm text-muted-foreground shadow-elev-1 transition-colors duration-md ease-md hover:border-border hover:bg-surface-container-high hover:text-foreground sm:h-11 sm:gap-2.5 sm:px-5"
            >
              <Search className="h-4 w-4 shrink-0" />
              <span className="hidden truncate sm:inline">Search PersonAI</span>
              <kbd className="ml-1 hidden shrink-0 rounded-md border border-border/80 bg-background/80 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground sm:inline">
                ⌘K
              </kbd>
            </button>
          </div>
          <div className="w-32 min-w-0 shrink-0 sm:w-52">
            {gate === "allowed" ? <ProfileSwitcher /> : null}
          </div>
        </header>

        <main
          className={cn(
            "min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4 lg:p-5 xl:px-6",
            "pb-[calc(4.75rem+env(safe-area-inset-bottom))] md:pb-5",
          )}
        >
          {gate === "allowed" ? (
            <>
              <DriveLinkBanner />
              {children}
            </>
          ) : (
            <div className="flex h-40 items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          )}
        </main>
        {gate === "allowed" ? <OutboxBootstrap /> : null}
      </div>

      {gate === "allowed" ? <MobileNav /> : null}

      {paletteOpen && gate === "allowed" && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px]"
            onClick={() => setPaletteOpen(false)}
          />
          <div className="fixed left-1/2 top-[max(1rem,12%)] z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 animate-scale-in overflow-hidden rounded-2xl border border-border/70 bg-card shadow-elev-3">
            <div className="border-b border-border/60 p-3.5">
              <div className="flex items-center gap-2.5 rounded-xl bg-surface-container px-3.5">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search commands..."
                  className="h-12 min-w-0 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
            </div>
            <ul className="max-h-[min(18rem,50dvh)] overflow-y-auto py-1.5">
              {filtered.map((item) => (
                <li key={item.href}>
                  <button
                    type="button"
                    onClick={() => navigate(item.href)}
                    className="md-list-row w-full justify-between gap-3 text-left text-sm hover:bg-surface-container-high"
                  >
                    <span className="min-w-0 truncate">{item.label}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{item.keys}</span>
                  </button>
                </li>
              ))}
              {filtered.length === 0 && (
                <li className="px-4 py-10 text-center text-sm text-muted-foreground">No results</li>
              )}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

export { CommandPalette } from "./CommandPalette";
