"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Plus, User, ArrowRight } from "lucide-react";
import { apiGet, apiPost, type Profile, type ProfileRegistry } from "@/lib/api-client";
import { loginWithProfile } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { pageVariants, staggerContainer, staggerItem } from "@/lib/motion";

export default function ProfilesPage() {
  const reduce = useReducedMotion();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiGet<ProfileRegistry>("/profiles")
      .then((registry) => setProfiles(registry.profiles))
      .catch(() => setError("Could not load profiles. Is the API running?"))
      .finally(() => setLoading(false));
  }, []);

  const selectProfile = async (profile: Profile) => {
    setSubmitting(true);
    setError(null);
    try {
      await loginWithProfile(profile.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to switch profile");
      setSubmitting(false);
    }
  };

  const createProfile = async () => {
    if (!newName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const profile = await apiPost<Profile>("/profiles", { name: newName.trim() });
      await loginWithProfile(profile.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create profile");
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-background p-6 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(900px 420px at 50% -8%, hsl(214 89% 51% / 0.14), transparent 55%), radial-gradient(640px 320px at 80% 100%, hsl(214 40% 20% / 0.2), transparent 50%)",
        }}
      />

      <motion.div
        className="relative z-[1] w-full max-w-md"
        variants={reduce ? undefined : pageVariants}
        initial={reduce ? undefined : "hidden"}
        animate={reduce ? undefined : "show"}
      >
        <div className="mb-10 text-center">
          <div className="mx-auto mb-6 flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-elev-2">
            <span className="text-3xl font-semibold tracking-tight">P</span>
          </div>
          <h1 className="text-[2rem] font-semibold tracking-tight text-foreground sm:text-[2.25rem]">
            PersonAI
          </h1>
          <p className="mt-2.5 text-[15px] leading-relaxed text-muted-foreground">
            Welcome back — choose an account to continue
          </p>
        </div>

        {error && (
          <p className="mb-4 animate-in rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-center text-sm text-destructive">
            {error}
          </p>
        )}

        <Card className="overflow-hidden shadow-elev-2 hover:shadow-elev-2">
          {loading ? (
            <div className="space-y-0 p-3">
              <Skeleton className="h-16 rounded-xl" />
              <Skeleton className="mt-2 h-16 rounded-xl" />
            </div>
          ) : (
            <motion.ul
              variants={reduce ? undefined : staggerContainer}
              initial={reduce ? undefined : "hidden"}
              animate={reduce ? undefined : "show"}
            >
              {profiles.map((profile) => (
                <motion.li key={profile.id} variants={reduce ? undefined : staggerItem}>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => void selectProfile(profile)}
                    className="md-list-row pressable w-full justify-between text-left disabled:pointer-events-none disabled:opacity-60"
                  >
                    <span className="flex min-w-0 items-center gap-3.5">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-container shadow-elev-1">
                        <User className="h-5 w-5 text-primary-on-container" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[15px] font-semibold tracking-tight">
                          {profile.name}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          Created {new Date(profile.createdAt).toLocaleDateString("de-CH")}
                        </span>
                      </span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-md ease-md group-hover:translate-x-0.5" />
                  </button>
                </motion.li>
              ))}
              {!profiles.length && (
                <li className="px-5 py-12 text-center text-sm leading-relaxed text-muted-foreground">
                  No profiles yet — create one to get started.
                </li>
              )}
            </motion.ul>
          )}
        </Card>

        <div className="mt-6">
          {creating ? (
            <Card className="animate-scale-in">
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row">
                <Input
                  autoFocus
                  placeholder="Profile name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void createProfile()}
                  disabled={submitting}
                />
                <div className="flex gap-2">
                  <Button onClick={() => void createProfile()} disabled={submitting}>
                    Create
                  </Button>
                  <Button variant="ghost" onClick={() => setCreating(false)} disabled={submitting}>
                    Cancel
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Button
              variant="tonal"
              className="w-full"
              onClick={() => setCreating(true)}
              disabled={submitting}
            >
              <Plus className="h-4 w-4" />
              Use another account
            </Button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
