"use client";

import { useEffect, useState } from "react";
import { Plus, User, ArrowRight } from "lucide-react";
import { apiGet, apiPost, type Profile, type ProfileRegistry } from "@/lib/api-client";
import { loginWithProfile } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function ProfilesPage() {
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
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-elev-1">
            <span className="text-2xl font-medium">P</span>
          </div>
          <h1 className="md-title-large text-[28px] font-normal tracking-tight">PersonAI</h1>
          <p className="mt-2 md-body-medium text-muted-foreground">
            Choose an account to continue
          </p>
        </div>

        {error && (
          <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">
            {error}
          </p>
        )}

        <Card className="overflow-hidden shadow-elev-2">
          {loading ? (
            <div className="space-y-0 p-2">
              <Skeleton className="h-14 rounded-md" />
              <Skeleton className="mt-2 h-14 rounded-md" />
            </div>
          ) : (
            <ul>
              {profiles.map((profile) => (
                <li key={profile.id}>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => void selectProfile(profile)}
                    className="md-list-row w-full justify-between text-left disabled:pointer-events-none disabled:opacity-60"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-container">
                        <User className="h-5 w-5 text-primary-on-container" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate md-label-large">{profile.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          Created {new Date(profile.createdAt).toLocaleDateString("de-CH")}
                        </span>
                      </span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              ))}
              {!profiles.length && (
                <li className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No profiles yet — create one to get started.
                </li>
              )}
            </ul>
          )}
        </Card>

        <div className="mt-6">
          {creating ? (
            <Card>
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
      </div>
    </div>
  );
}
