"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronsUpDown, Plus, User } from "lucide-react";
import { apiGet, apiPost, setProfileId, type Profile, type ProfileRegistry } from "@/lib/api-client";
import { getStoredProfileId, setStoredProfileId } from "@/lib/platform";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function ProfileSwitcher({ className }: { className?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(false);

  const loadProfiles = async () => {
    const registry = await apiGet<ProfileRegistry>("/profiles");
    setProfiles(registry.profiles);
    const stored = getStoredProfileId() ?? registry.activeProfileId;
    if (stored) {
      setActiveId(stored);
      setProfileId(stored);
    }
  };

  useEffect(() => {
    void loadProfiles().catch(() => undefined);
    const onChange = () => {
      setActiveId(getStoredProfileId());
    };
    window.addEventListener("personai:profile-changed", onChange);
    return () => window.removeEventListener("personai:profile-changed", onChange);
  }, []);

  const activeProfile = profiles.find((p) => p.id === activeId);

  const handleSwitch = async (profileId: string) => {
    setLoading(true);
    try {
      await apiPost("/profiles/switch", { profileId });
      setStoredProfileId(profileId);
      setProfileId(profileId);
      setActiveId(profileId);
      setOpen(false);
      router.refresh();
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setLoading(true);
    try {
      const profile = await apiPost<Profile>("/profiles", { name: newName.trim() });
      setStoredProfileId(profile.id);
      setProfileId(profile.id);
      setActiveId(profile.id);
      setNewName("");
      setCreating(false);
      setOpen(false);
      await loadProfiles();
      router.push("/dashboard");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={cn("relative", className)}>
      <Button
        variant="outline"
        className="w-full justify-between border-border bg-muted/20"
        onClick={() => setOpen((v) => !v)}
        disabled={loading}
      >
        <span className="flex items-center gap-2 truncate">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-500/20">
            {activeProfile?.avatar ? (
              <span>{activeProfile.avatar}</span>
            ) : (
              <User className="h-3.5 w-3.5 text-teal-400" />
            )}
          </span>
          <span className="truncate">{activeProfile?.name ?? "Select profile"}</span>
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full z-50 mt-2 rounded-lg border border-border bg-zinc-900 p-2 shadow-xl">
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {profiles.map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => void handleSwitch(profile.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50",
                    profile.id === activeId && "bg-teal-500/10 text-teal-300",
                  )}
                >
                  <User className="h-4 w-4" />
                  {profile.name}
                </button>
              ))}
            </div>
            <div className="mt-2 border-t border-border pt-2">
              {creating ? (
                <div className="flex gap-2">
                  <Input
                    placeholder="Profile name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void handleCreate()}
                  />
                  <Button size="sm" onClick={() => void handleCreate()} disabled={loading}>
                    Add
                  </Button>
                </div>
              ) : (
                <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => setCreating(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  New profile
                </Button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
