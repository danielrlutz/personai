"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Plus, User, ArrowRight, Lock, KeyRound } from "lucide-react";
import { apiGet, type Profile, type ProfileRegistry } from "@/lib/api-client";
import {
  createProfileWithPassword,
  enterApp,
  loginWithPassword,
  setupPassword,
} from "@/lib/session";
import {
  DEFAULT_PROFILE_NAME_LIMITS,
  validateProfileNameClient,
  type ProfileNameLimits,
} from "@/lib/profile-name-limits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { pageVariants, staggerContainer, staggerItem } from "@/lib/motion";

type Step =
  | { kind: "list" }
  | { kind: "login"; profile: Profile }
  | { kind: "setup"; profile: Profile }
  | { kind: "create" };

export default function ProfilesPage() {
  const reduce = useReducedMotion();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>({ kind: "list" });
  const [newName, setNewName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameLimits, setNameLimits] = useState<ProfileNameLimits>(DEFAULT_PROFILE_NAME_LIMITS);

  useEffect(() => {
    void apiGet<ProfileRegistry>("/profiles")
      .then((registry) => {
        setProfiles(registry.profiles);
        if (registry.nameLimits) setNameLimits(registry.nameLimits);
      })
      .catch(() => setError("Could not load profiles. Is the API running?"))
      .finally(() => setLoading(false));
  }, []);

  const resetPasswordFields = () => {
    setPassword("");
    setPasswordConfirm("");
  };

  const selectProfile = (profile: Profile) => {
    setError(null);
    resetPasswordFields();
    if (profile.needsCryptoRestore) {
      setError(
        `Unlock keys missing for “${profile.name}”. On the VPS restore profiles.json ` +
          `(passwordHash/kdfSalt/wrappedDek), or run ` +
          `./scripts/emergency-reset-profile-crypto.sh ${profile.id} then Set password.`,
      );
      return;
    }
    if (profile.hasPassword) {
      setStep({ kind: "login", profile });
    } else {
      setStep({ kind: "setup", profile });
    }
  };

  const submitLogin = async () => {
    if (step.kind !== "login" || !password) return;
    setSubmitting(true);
    setError(null);
    try {
      await loginWithPassword(step.profile.id, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setSubmitting(false);
    }
  };

  const submitSetup = async () => {
    if (step.kind !== "setup") return;
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== passwordConfirm) {
      setError("Passwords do not match");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await setupPassword(step.profile.id, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set password");
      setSubmitting(false);
    }
  };

  const submitCreate = async () => {
    const nameError = validateProfileNameClient(newName, nameLimits);
    if (nameError) {
      setError(nameError);
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== passwordConfirm) {
      setError("Passwords do not match");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createProfileWithPassword(newName.trim(), password);
      await enterApp();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create profile");
      setSubmitting(false);
    }
  };

  const backToList = () => {
    setStep({ kind: "list" });
    setError(null);
    resetPasswordFields();
    setNewName("");
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
            {step.kind === "login"
              ? `Enter password for ${step.profile.name}`
              : step.kind === "setup"
                ? `Set a password for ${step.profile.name}`
                : step.kind === "create"
                  ? "Create a protected account"
                  : "Sign in — your data is password-protected"}
          </p>
        </div>

        {error && (
          <p className="mb-4 animate-in rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-center text-sm text-destructive">
            {error}
          </p>
        )}

        {step.kind === "list" && (
          <>
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
                        onClick={() => selectProfile(profile)}
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
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              {profile.needsCryptoRestore ? (
                                <>
                                  <Lock className="h-3 w-3" /> Restore unlock keys
                                </>
                              ) : profile.hasPassword ? (
                                <>
                                  <Lock className="h-3 w-3" /> Password protected
                                </>
                              ) : (
                                <>
                                  <KeyRound className="h-3 w-3" /> Set password to continue
                                </>
                              )}
                            </span>
                          </span>
                        </span>
                        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
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
              <Button
                variant="tonal"
                className="w-full"
                onClick={() => {
                  setStep({ kind: "create" });
                  setError(null);
                  resetPasswordFields();
                }}
                disabled={submitting}
              >
                <Plus className="h-4 w-4" />
                Use another account
              </Button>
            </div>
          </>
        )}

        {(step.kind === "login" || step.kind === "setup" || step.kind === "create") && (
          <Card className="animate-scale-in shadow-elev-2">
            <CardContent className="flex flex-col gap-3 p-4">
              {(step.kind === "login" || step.kind === "setup") && (
                <Input
                  type="text"
                  name="username"
                  autoComplete="username"
                  value={step.profile.name}
                  readOnly
                  tabIndex={-1}
                  aria-hidden="true"
                  className="sr-only"
                />
              )}
              {step.kind === "create" && (
                <>
                  <Input
                    autoFocus
                    name="username"
                    placeholder="Profile name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value.slice(0, nameLimits.maxLength))}
                    disabled={submitting}
                    autoComplete="username"
                    maxLength={nameLimits.maxLength}
                  />
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Up to {nameLimits.maxLength} characters — sized to fit the header on phone (
                    {nameLimits.visibleChars.mobile}) and desktop ({nameLimits.visibleChars.sm}).
                  </p>
                </>
              )}
              <Input
                autoFocus={step.kind !== "create"}
                type="password"
                name="password"
                placeholder={step.kind === "login" ? "Password" : "Choose a password (min 8)"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  if (step.kind === "login") void submitLogin();
                  else if (step.kind === "setup") void submitSetup();
                  else void submitCreate();
                }}
                disabled={submitting}
                autoComplete={step.kind === "login" ? "current-password" : "new-password"}
              />
              {step.kind !== "login" && (
                <Input
                  type="password"
                  name="password-confirm"
                  placeholder="Confirm password"
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    if (step.kind === "setup") void submitSetup();
                    else void submitCreate();
                  }}
                  disabled={submitting}
                  autoComplete="new-password"
                />
              )}
              {step.kind === "setup" && (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  This encrypts your profile database at rest. You will need this password on every
                  device that opens this account.
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  onClick={() => {
                    if (step.kind === "login") void submitLogin();
                    else if (step.kind === "setup") void submitSetup();
                    else void submitCreate();
                  }}
                  disabled={submitting || !password || (step.kind === "create" && !newName.trim())}
                >
                  {submitting
                    ? "Please wait…"
                    : step.kind === "login"
                      ? "Unlock"
                      : step.kind === "setup"
                        ? "Set password & continue"
                        : "Create & unlock"}
                </Button>
                <Button variant="ghost" onClick={backToList} disabled={submitting}>
                  Back
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </motion.div>
    </div>
  );
}
