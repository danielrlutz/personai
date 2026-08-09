"use client";

import { useEffect, useState } from "react";
import { ChevronsUpDown, LogOut, User, Users } from "lucide-react";
import { apiGet, type Profile, type ProfileRegistry } from "@/lib/api-client";
import { getActiveProfileId, logoutToProfiles } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ProfileSwitcher({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<"switch" | "signout" | null>(null);
  const [activeProfile, setActiveProfile] = useState<Profile | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const registry = await apiGet<ProfileRegistry>("/profiles");
        const id = getActiveProfileId() ?? registry.activeProfileId;
        setActiveProfile(registry.profiles.find((p) => p.id === id) ?? null);
      } catch {
        setActiveProfile(null);
      }
    };
    void load();

    const onChange = () => {
      const id = getActiveProfileId();
      if (!id) {
        setActiveProfile(null);
        return;
      }
      void load();
    };
    window.addEventListener("personai:profile-changed", onChange);
    return () => window.removeEventListener("personai:profile-changed", onChange);
  }, []);

  const leaveSession = (mode: "switch" | "signout") => {
    setConfirming(mode);
  };

  const confirmLeave = () => {
    setOpen(false);
    setConfirming(null);
    logoutToProfiles();
  };

  return (
    <div className={cn("relative", className)}>
      <Button
        variant="outline"
        className="w-full justify-between border-border/70 bg-surface-container/90 shadow-elev-1 hover:bg-surface-container-high"
        onClick={() => {
          setOpen((v) => !v);
          setConfirming(null);
        }}
      >
        <span className="flex min-w-0 items-center gap-2 truncate">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-container">
            {activeProfile?.avatar ? (
              <span>{activeProfile.avatar}</span>
            ) : (
              <User className="h-3.5 w-3.5 text-primary-on-container" />
            )}
          </span>
          <span className="truncate font-medium">{activeProfile?.name ?? "Profile"}</span>
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
      </Button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => {
              setOpen(false);
              setConfirming(null);
            }}
          />
          <div className="absolute left-0 right-0 top-full z-50 mt-2 animate-scale-in overflow-hidden rounded-2xl border border-border/70 bg-card p-1.5 shadow-elev-3">
            {confirming ? (
              <div className="space-y-3 p-3">
                <p className="md-body-medium text-muted-foreground">
                  {confirming === "switch"
                    ? "Leave this session and pick another profile?"
                    : "Sign out and return to the profile picker?"}
                </p>
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1" onClick={confirmLeave}>
                    {confirming === "switch" ? "Continue" : "Sign out"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="flex-1"
                    onClick={() => setConfirming(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="py-0.5">
                <button
                  type="button"
                  onClick={() => leaveSession("switch")}
                  className="pressable flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm transition-colors duration-md ease-md hover:bg-surface-container-high"
                >
                  <Users className="h-4 w-4 text-primary" />
                  Switch profile
                </button>
                <button
                  type="button"
                  onClick={() => leaveSession("signout")}
                  className="pressable flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm text-destructive transition-colors duration-md ease-md hover:bg-destructive/10"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
