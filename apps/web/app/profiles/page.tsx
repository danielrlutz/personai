"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Plus, User, ArrowRight } from "lucide-react";
import { apiGet, apiPost, setProfileId, type Profile, type ProfileRegistry } from "@/lib/api-client";
import { getStoredProfileId, setStoredProfileId } from "@/lib/platform";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function ProfilesPage() {
  const router = useRouter();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void apiGet<ProfileRegistry>("/profiles")
      .then((registry) => setProfiles(registry.profiles))
      .finally(() => setLoading(false));
  }, []);

  const selectProfile = async (profile: Profile) => {
    setSubmitting(true);
    try {
      await apiPost("/profiles/switch", { profileId: profile.id });
      setStoredProfileId(profile.id);
      setProfileId(profile.id);
      router.push("/dashboard");
    } finally {
      setSubmitting(false);
    }
  };

  const createProfile = async () => {
    if (!newName.trim()) return;
    setSubmitting(true);
    try {
      const profile = await apiPost<Profile>("/profiles", { name: newName.trim() });
      setStoredProfileId(profile.id);
      setProfileId(profile.id);
      router.push("/dashboard");
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    const stored = getStoredProfileId();
    if (stored && profiles.some((p) => p.id === stored)) {
      // Optional auto-resume for returning users
    }
  }, [profiles]);

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden p-6 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_50%_-10%,rgba(20,184,166,0.22),transparent)]"
      />
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-lg"
      >
        <div className="mb-10 text-center">
          <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-3xl border border-teal-500/30 bg-teal-500/15 shadow-[0_0_40px_-12px_rgba(20,184,166,0.55)]">
            <span className="text-3xl font-bold tracking-tight text-teal-300">P</span>
          </div>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Person<span className="text-teal-400">AI</span>
          </h1>
          <p className="mt-1 text-lg font-medium text-foreground/90">OS</p>
          <p className="mt-3 text-muted-foreground">
            Privacy-first life management — pick a profile to continue
          </p>
        </div>

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 rounded-lg" />
            <Skeleton className="h-16 rounded-lg" />
          </div>
        ) : (
          <div className="space-y-3">
            {profiles.map((profile) => (
              <Card
                key={profile.id}
                className="cursor-pointer transition-colors hover:border-teal-500/40"
                onClick={() => void selectProfile(profile)}
              >
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-500/15">
                      <User className="h-5 w-5 text-teal-400" />
                    </div>
                    <div>
                      <p className="font-medium">{profile.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Created {new Date(profile.createdAt).toLocaleDateString("de-CH")}
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <div className="mt-8 rounded-xl border border-border bg-muted/10 p-4">
          {creating ? (
            <div className="flex gap-2">
              <Input
                autoFocus
                placeholder="Profile name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void createProfile()}
              />
              <Button onClick={() => void createProfile()} disabled={submitting}>
                Create
              </Button>
              <Button variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="outline" className="w-full" onClick={() => setCreating(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New profile
            </Button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
