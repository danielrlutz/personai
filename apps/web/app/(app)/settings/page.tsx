"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Settings, Server, User, Shield, Cpu, Brain, Trash2, HardDrive } from "lucide-react";
import { ProductSettingsCard } from "@/components/settings/ProductSettingsCard";
import { InstallAppCard } from "@/components/shared/InstallAppCard";
import {
  clearAppPin,
  getIdleLockMs,
  isLockEnabled,
  setAppPin,
  setIdleLockMs,
} from "@/lib/app-lock";
import { getStoredTheme, type ThemePreference } from "@/lib/theme";
import { setThemePreference } from "@/components/shared/ThemeProvider";
import {
  apiDelete,
  apiGet,
  apiPost,
  apiPut,
  getApiBaseUrl,
  getSuggestedApiBaseUrl,
  setApiBaseUrl,
  type ArchiveRefreshResult,
  type CeoProfile,
  type DriveOauthStart,
  type DriveStatus,
  type LicenseInfo,
  type MemoryFact,
  type OllamaHealth,
  type ProfileRegistry,
  type UsageMode,
} from "@/lib/api-client";
import {
  getStoredProfileId,
  getStoredApiBaseUrl,
  normalizeApiBaseUrl,
  getPlatform,
} from "@/lib/platform";
import { getActiveProfileId, logoutToProfiles } from "@/lib/session";
import { clearDriveStatusCache } from "@/lib/drive-status";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { PageEnter } from "@/components/motion/PageEnter";
import { cn } from "@/lib/utils";
import {
  DEFAULT_USAGE_MODE,
  USAGE_MODE_OPTIONS,
  normalizeUsageMode,
  notifyUsageModeChanged,
} from "@/lib/usage-mode";

function runtimeBadge(runtime?: OllamaHealth["runtime"]): string {
  switch (runtime) {
    case "native":
      return "Native";
    case "docker":
      return "Docker";
    case "remote":
      return "Remote";
    default:
      return "Unknown";
  }
}

const emptyCeo: CeoProfile = {
  displayName: null,
  company: null,
  usageMode: DEFAULT_USAGE_MODE,
  locale: null,
  language: null,
  timezone: null,
  briefHour: null,
  notes: null,
};

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const [apiUrl, setApiUrl] = useState("");
  const [apiNote, setApiNote] = useState<string | null>(null);
  const [apiTesting, setApiTesting] = useState(false);
  const [suggestedApiUrl, setSuggestedApiUrl] = useState<string | null>(null);
  const [license, setLicense] = useState<LicenseInfo | null>(null);
  const [profileName, setProfileName] = useState("");
  const [saved, setSaved] = useState(false);
  const [ollama, setOllama] = useState<OllamaHealth | null>(null);
  const [ollamaHost, setOllamaHost] = useState("");
  const [ollamaNote, setOllamaNote] = useState<string | null>(null);
  const [ollamaSaving, setOllamaSaving] = useState(false);
  const [ceo, setCeo] = useState<CeoProfile>(emptyCeo);
  const [ceoSaving, setCeoSaving] = useState(false);
  const [ceoNote, setCeoNote] = useState<string | null>(null);
  const [facts, setFacts] = useState<MemoryFact[]>([]);
  const [factKey, setFactKey] = useState("");
  const [factValue, setFactValue] = useState("");
  const [factSaving, setFactSaving] = useState(false);
  const [factNote, setFactNote] = useState<string | null>(null);
  const [distillBusy, setDistillBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordNote, setPasswordNote] = useState<string | null>(null);
  const [drive, setDrive] = useState<DriveStatus | null>(null);
  const [driveRoot, setDriveRoot] = useState("");
  const [driveNote, setDriveNote] = useState<string | null>(null);
  const [driveBusy, setDriveBusy] = useState(false);
  const platform = typeof window !== "undefined" ? getPlatform() : "browser";
  const [themePref, setThemePref] = useState<ThemePreference>("system");
  const [pinInput, setPinInput] = useState("");
  const [lockNote, setLockNote] = useState<string | null>(null);

  useEffect(() => {
    setThemePref(getStoredTheme());
  }, []);

  const refreshOllama = async () => {
    try {
      const data = await apiGet<OllamaHealth>("/ollama/health", { silent: true });
      setOllama(data);
      setOllamaHost(data.configuredHost ?? data.host ?? "http://127.0.0.1:11434");
    } catch {
      setOllama({ ok: false });
    }
  };

  const refreshMemory = async () => {
    try {
      const [profile, mem] = await Promise.all([
        apiGet<CeoProfile>("/ceo-profile"),
        apiGet<{ facts: MemoryFact[] }>("/memory-facts"),
      ]);
      setCeo({
        displayName: profile.displayName ?? null,
        company: profile.company ?? null,
        usageMode: normalizeUsageMode(profile.usageMode),
        locale: profile.locale ?? null,
        language: profile.language ?? null,
        timezone: profile.timezone ?? null,
        briefHour: profile.briefHour ?? null,
        notes: profile.notes ?? null,
      });
      setFacts(mem.facts ?? []);
    } catch {
      setFactNote("Could not load profile / memory.");
    }
  };

  const refreshDrive = async () => {
    try {
      clearDriveStatusCache();
      const status = await apiGet<DriveStatus>("/archive/drive", { silent: true });
      setDrive(status);
      setDriveRoot(status.rootFolderId ?? "");
    } catch {
      setDrive(null);
      setDriveNote("Could not load Google Drive status.");
    }
  };

  useEffect(() => {
    setApiUrl(getStoredApiBaseUrl() ?? getApiBaseUrl());
    setSuggestedApiUrl(getSuggestedApiBaseUrl());
    void apiGet<LicenseInfo>("/license", { silent: true }).then(setLicense).catch(() => undefined);
    void apiGet<ProfileRegistry>("/profiles", { silent: true }).then((registry) => {
      const id = getActiveProfileId();
      const profile = registry.profiles.find((p) => p.id === id);
      setProfileName(profile?.name ?? "Unknown");
    });
    void refreshOllama();
    void refreshMemory();
    void refreshDrive();
  }, []);

  useEffect(() => {
    const driveFlag = searchParams.get("drive");
    const focus = searchParams.get("focus");
    if (driveFlag === "linked") {
      setDriveNote("Google Drive linked. Archive context is initializing — you can refresh below.");
      void refreshDrive();
    } else if (driveFlag === "error") {
      setDriveNote(searchParams.get("message") || "Google Drive link failed.");
    }
    if (focus === "drive" || driveFlag) {
      requestAnimationFrame(() => {
        document.getElementById("drive-settings")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, [searchParams]);

  const linkGoogleDrive = async () => {
    setDriveBusy(true);
    setDriveNote(null);
    try {
      const start = await apiPost<DriveOauthStart>("/archive/drive/oauth/start", {
        returnTo: `${window.location.origin}/settings/`,
      });
      window.location.href = start.url;
    } catch (err) {
      setDriveNote(err instanceof Error ? err.message : "Could not start Google link");
      setDriveBusy(false);
    }
  };

  const verifyDrive = async () => {
    setDriveBusy(true);
    setDriveNote(null);
    try {
      const result = await apiPost<{ ok: boolean; message: string; linked: boolean }>(
        "/archive/drive/verify",
      );
      setDriveNote(result.message);
      await refreshDrive();
    } catch (err) {
      setDriveNote(err instanceof Error ? err.message : "Drive verify failed");
    } finally {
      setDriveBusy(false);
    }
  };

  const saveDriveRoot = async () => {
    setDriveBusy(true);
    setDriveNote(null);
    try {
      const status = await apiPut<DriveStatus>("/archive/drive/prefs", {
        rootFolderId: driveRoot.trim() || null,
      });
      setDrive(status);
      setDriveNote(status.linked ? "Archive root saved." : status.message);
      clearDriveStatusCache();
    } catch (err) {
      setDriveNote(err instanceof Error ? err.message : "Could not save root folder");
    } finally {
      setDriveBusy(false);
    }
  };

  const refreshArchiveContext = async () => {
    setDriveBusy(true);
    setDriveNote(null);
    try {
      const result = await apiPost<ArchiveRefreshResult>("/archive/drive/refresh-context");
      setDriveNote(result.message);
      if (result.status) setDrive(result.status);
      else await refreshDrive();
      await refreshMemory();
      clearDriveStatusCache();
    } catch (err) {
      setDriveNote(err instanceof Error ? err.message : "Could not refresh archive context");
    } finally {
      setDriveBusy(false);
    }
  };

  const unlinkDrive = async () => {
    setDriveBusy(true);
    setDriveNote(null);
    try {
      const status = await apiPost<DriveStatus & { ok: boolean }>("/archive/drive/unlink");
      setDrive(status);
      setDriveRoot(status.rootFolderId ?? "");
      setDriveNote("OAuth link removed for this profile.");
      clearDriveStatusCache();
    } catch (err) {
      setDriveNote(err instanceof Error ? err.message : "Could not unlink Drive");
    } finally {
      setDriveBusy(false);
    }
  };

  const saveApiUrl = async (urlOverride?: string) => {
    const normalized = normalizeApiBaseUrl(urlOverride ?? apiUrl);
    if (!normalized) {
      setApiNote("Enter a URL like http://debi9.tail8175e6.ts.net:4000 (no trailing slash).");
      return;
    }
    setApiUrl(normalized);
    setApiBaseUrl(normalized);
    setApiTesting(true);
    setApiNote(null);
    setSaved(false);
    try {
      const res = await fetch(`${normalized}/health`, { method: "GET" });
      if (!res.ok) {
        throw new Error(`Health check returned ${res.status}`);
      }
      const body = (await res.json()) as { ok?: boolean };
      if (!body.ok) throw new Error("Health check did not return ok");
      setSaved(true);
      setApiNote(`Connected to ${normalized}. Reloading so all pages use this API…`);
      window.setTimeout(() => {
        window.location.reload();
      }, 600);
    } catch (err) {
      setApiNote(
        `${err instanceof Error ? err.message : "Failed to fetch"} — URL saved anyway. ` +
          `On phone use MagicDNS FQDN http://HOST.tailnet.ts.net:4000 (no trailing slash). ` +
          `Clear site data if the build baked a wrong NEXT_PUBLIC_API_URL.`,
      );
      // Still persist so override wins over a bad baked-in env after reload
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setApiTesting(false);
    }
  };

  const saveOllamaHost = async () => {
    setOllamaSaving(true);
    setOllamaNote(null);
    try {
      const data = await apiPut<OllamaHealth>("/ollama/host", { host: ollamaHost.trim() });
      setOllama(data);
      setOllamaHost(data.configuredHost ?? data.host ?? ollamaHost.trim());
      setOllamaNote(data.note ?? (data.ok ? "Ollama host updated." : "Host saved; offline."));
    } catch (err) {
      setOllamaNote(err instanceof Error ? err.message : "Failed to update Ollama host");
    } finally {
      setOllamaSaving(false);
    }
  };

  const saveCeo = async () => {
    setCeoSaving(true);
    setCeoNote(null);
    try {
      const updated = await apiPut<CeoProfile>("/ceo-profile", {
        ...ceo,
        usageMode: normalizeUsageMode(ceo.usageMode),
      });
      setCeo({
        displayName: updated.displayName ?? null,
        company: updated.company ?? null,
        usageMode: normalizeUsageMode(updated.usageMode),
        locale: updated.locale ?? null,
        language: updated.language ?? null,
        timezone: updated.timezone ?? null,
        briefHour: updated.briefHour ?? null,
        notes: updated.notes ?? null,
      });
      notifyUsageModeChanged();
      setCeoNote("Profile saved. Specialists see a short summary of you each turn.");
    } catch (err) {
      setCeoNote(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setCeoSaving(false);
    }
  };

  const addFact = async () => {
    if (!factKey.trim() || !factValue.trim()) return;
    setFactSaving(true);
    setFactNote(null);
    try {
      await apiPost<MemoryFact>("/memory-facts", {
        key: factKey.trim(),
        value: factValue.trim(),
        source: "settings",
      });
      setFactKey("");
      setFactValue("");
      await refreshMemory();
      setFactNote("Fact saved. Up to 20 recent facts appear in chat and the morning brief.");
    } catch (err) {
      setFactNote(err instanceof Error ? err.message : "Failed to save fact");
    } finally {
      setFactSaving(false);
    }
  };

  const deleteFact = async (id: string) => {
    setFactNote(null);
    try {
      await apiDelete<{ ok: boolean }>(`/memory-facts/${id}`);
      setFacts((prev) => prev.filter((f) => f.id !== id));
    } catch (err) {
      setFactNote(err instanceof Error ? err.message : "Failed to delete fact");
    }
  };

  const distillFromChats = async () => {
    setDistillBusy(true);
    setFactNote(null);
    try {
      const data = await apiPost<{
        queued: number;
        message?: string;
        candidates: Array<{ key: string; value: string }>;
      }>("/memory-facts/distill", {});
      setFactNote(
        data.message ??
          (data.queued > 0
            ? `${data.queued} promotion(s) queued — confirm on Home.`
            : "No new durable facts found."),
      );
    } catch (err) {
      setFactNote(err instanceof Error ? err.message : "Distill failed");
    } finally {
      setDistillBusy(false);
    }
  };

  const changePassword = async () => {
    if (newPassword.length < 8) {
      setPasswordNote("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordNote("New passwords do not match.");
      return;
    }
    setPasswordSaving(true);
    setPasswordNote(null);
    try {
      await apiPost("/auth/password/change", {
        currentPassword,
        newPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordNote("Password updated. Your encrypted database key was re-wrapped.");
    } catch (err) {
      setPasswordNote(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setPasswordSaving(false);
    }
  };

  return (
    <PageEnter className="mx-auto w-full max-w-3xl space-y-4 sm:space-y-5">
      <div className="page-header min-w-0">
        <div className="mb-1 flex items-center gap-2.5 text-primary">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-container shadow-elev-1">
            <Settings className="h-4 w-4 text-primary-on-container" />
          </span>
          <span className="md-label-large">Account</span>
        </div>
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">
          Connection, profile, and personal details for this account.
        </p>
      </div>

      <div className="min-w-0 space-y-4">
      <Card className="animate-in">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Server className="h-4 w-4 text-primary" />
            API Server
          </CardTitle>
          <CardDescription>
            Overrides the baked-in build URL (localStorage). On Tailscale, when UI and API share a
            hostname, the client defaults to{" "}
            <span className="font-mono text-foreground">http://&lt;host&gt;:4000</span> without a
            manual override. Takes effect even when NEXT_PUBLIC_API_URL was wrong at image build.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder={suggestedApiUrl ?? "http://debi9.tail8175e6.ts.net:4000"}
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          {suggestedApiUrl ? (
            <p className="text-xs text-muted-foreground">
              Detected for this host:{" "}
              <span className="font-mono text-foreground">{suggestedApiUrl}</span>
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {suggestedApiUrl && normalizeApiBaseUrl(apiUrl) !== suggestedApiUrl ? (
              <Button
                type="button"
                variant="outline"
                disabled={apiTesting}
                onClick={() => void saveApiUrl(suggestedApiUrl)}
              >
                Use this host&apos;s API
              </Button>
            ) : null}
            <Button onClick={() => void saveApiUrl()} disabled={apiTesting || !apiUrl.trim()}>
              {apiTesting ? "Testing…" : saved ? "Saved!" : "Save & test API URL"}
            </Button>
          </div>
          {apiNote ? <p className="text-xs text-muted-foreground">{apiNote}</p> : null}
          <p className="text-xs text-muted-foreground">
            Active: <span className="font-mono text-foreground">{getApiBaseUrl()}</span>
          </p>
        </CardContent>
      </Card>

      <ProductSettingsCard />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Theme & lock</CardTitle>
          <CardDescription>
            OS follow or override. Optional PIN locks the UI on idle / resume (DB still sealed by password).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {(["system", "dark", "light"] as ThemePreference[]).map((t) => (
              <Button
                key={t}
                size="sm"
                variant={themePref === t ? "default" : "outline"}
                onClick={() => {
                  setThemePreference(t);
                  setThemePref(t);
                }}
              >
                {t}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Input
              type="password"
              inputMode="numeric"
              placeholder={isLockEnabled() ? "New PIN (rotate)" : "Set 4–8 digit PIN"}
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value.replace(/\D/g, "").slice(0, 8))}
              className="max-w-[12rem]"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void setAppPin(pinInput)
                  .then(() => {
                    setPinInput("");
                    setLockNote("PIN enabled — locks on tab hide / idle.");
                  })
                  .catch((err) => setLockNote(err instanceof Error ? err.message : "PIN failed"))
              }
            >
              Enable PIN
            </Button>
            {isLockEnabled() ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  clearAppPin();
                  setLockNote("PIN cleared.");
                }}
              >
                Disable
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Idle lock: {Math.round(getIdleLockMs() / 60000)} min
            <button
              type="button"
              className="ml-2 underline"
              onClick={() => {
                setIdleLockMs(5 * 60_000);
                setLockNote("Idle set to 5 minutes.");
              }}
            >
              reset 5m
            </button>
          </p>
          {lockNote ? <p className="text-xs text-muted-foreground">{lockNote}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Cpu className="h-4 w-4 text-primary" />
            Ollama status
          </CardTitle>
          <CardDescription>
            Live reachability. Persist host + models in Product vault above (not .env).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={ollama?.ok ? "default" : "destructive"}>
              {ollama?.ok ? "Reachable" : "Offline"}
            </Badge>
            <Badge variant="outline">{runtimeBadge(ollama?.runtime)}</Badge>
            {ollama?.failoverOk ? <Badge variant="outline">Failover OK</Badge> : null}
            {ollama?.apiInDocker ? <Badge variant="outline">API in Docker</Badge> : null}
            {ollama?.ok && ollama.models ? (
              <span className="text-xs text-muted-foreground">{ollama.models.length} models</span>
            ) : null}
          </div>
          {ollama?.host ? (
            <p className="break-all text-sm text-muted-foreground">
              Active: <span className="font-mono text-foreground">{ollama.host}</span>
              {ollama.configuredHost && ollama.configuredHost !== ollama.host ? (
                <span className="ml-2 break-all text-xs">
                  (configured {ollama.configuredHost})
                </span>
              ) : null}
            </p>
          ) : null}
          {ollama?.candidateStatus?.length ? (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {ollama.candidateStatus.map((c) => (
                <li key={c.host} className="flex min-w-0 items-center gap-2 font-mono">
                  <span className={c.up ? "text-success" : "text-destructive"}>{c.up ? "●" : "○"}</span>
                  <span
                    className={cn(
                      "min-w-0 truncate",
                      c.host === ollama.host ? "text-foreground" : undefined,
                    )}
                  >
                    {c.host}
                  </span>
                  <span className="shrink-0 text-muted-foreground">({runtimeBadge(c.runtime)})</span>
                </li>
              ))}
            </ul>
          ) : null}
          {ollama?.hints ? (
            <p className="text-xs text-muted-foreground">
              Hints: native {ollama.hints.native}
              {" · "}
              Docker→host {ollama.hints.dockerFromApi}
              {" · "}
              compose {ollama.hints.composeService}
            </p>
          ) : null}
          <Input
            value={ollamaHost}
            onChange={(e) => setOllamaHost(e.target.value)}
            placeholder="http://127.0.0.1:11434"
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void saveOllamaHost()} disabled={ollamaSaving || !ollamaHost.trim()}>
              {ollamaSaving ? "Saving…" : "Use this Ollama host"}
            </Button>
            <Button variant="outline" onClick={() => void refreshOllama()}>
              Refresh status
            </Button>
          </div>
          {ollamaNote ? <p className="text-xs text-muted-foreground">{ollamaNote}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="h-4 w-4 text-primary" />
            Active profile
          </CardTitle>
          <CardDescription>
            Sign out returns to the account picker. Your API URL and local data stay on this device.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="truncate font-semibold tracking-tight">{profileName}</p>
            <p className="truncate font-mono text-xs text-muted-foreground">{getStoredProfileId()}</p>
          </div>
          <Button variant="outline" className="shrink-0" onClick={() => logoutToProfiles()}>
            Switch profile
          </Button>
        </CardContent>
      </Card>

      <Card id="drive-settings">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HardDrive className="h-4 w-4 text-primary" />
            Google Drive archive
          </CardTitle>
          <CardDescription>
            Link Drive early so specialists can see your filed documents. Until then, chat still
            works — without archive context.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={drive?.linked ? "default" : "outline"}>
              {drive?.linked ? "Linked" : "Not linked"}
            </Badge>
            {drive?.mode && drive.mode !== "none" ? (
              <Badge variant="outline">
                {drive.mode === "oauth" ? "Your Google account" : "Service account"}
              </Badge>
            ) : null}
            {drive?.archiveContext?.ready ? (
              <Badge variant="outline">Archive context ready</Badge>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {drive?.message ?? "Loading Drive status…"}
          </p>
          {drive?.serviceAccountEmail ? (
            <p className="text-xs text-muted-foreground">
              Service account:{" "}
              <span className="font-mono text-foreground">{drive.serviceAccountEmail}</span>
              . Share your archive folders with this email (Editor), then set the root folder id
              below and verify.
            </p>
          ) : null}
          {drive?.canStartOauth ? (
            <p className="text-xs text-muted-foreground">
              OAuth redirect must match:{" "}
              <span className="font-mono text-foreground break-all">
                {drive.oauthRedirectUri ?? "GOOGLE_OAUTH_REDIRECT_URI"}
              </span>
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Paste OAuth client id/secret once in <span className="font-medium">Product vault</span>{" "}
              above, then Link Google Drive. No SSH / .env required for normal use.
            </p>
          )}
          <Input
            value={driveRoot}
            onChange={(e) => setDriveRoot(e.target.value)}
            placeholder="Drive root folder ID (optional if taxonomy folders are set)"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <div className="flex flex-wrap gap-2">
            {drive?.canStartOauth && !drive.linked ? (
              <Button onClick={() => void linkGoogleDrive()} disabled={driveBusy}>
                {driveBusy ? "Opening Google…" : "Link Google Drive"}
              </Button>
            ) : null}
            {drive?.canStartOauth && drive.linked && drive.mode === "oauth" ? (
              <Button variant="outline" onClick={() => void linkGoogleDrive()} disabled={driveBusy}>
                Re-link Google account
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => void saveDriveRoot()} disabled={driveBusy}>
              Save root folder
            </Button>
            <Button variant="outline" onClick={() => void verifyDrive()} disabled={driveBusy}>
              Verify connection
            </Button>
            <Button
              variant="outline"
              onClick={() => void refreshArchiveContext()}
              disabled={driveBusy || !(drive?.linked || drive?.enabled)}
            >
              Refresh archive context
            </Button>
            {drive?.mode === "oauth" ? (
              <Button variant="ghost" onClick={() => void unlinkDrive()} disabled={driveBusy}>
                Unlink
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => void refreshDrive()} disabled={driveBusy}>
              Refresh status
            </Button>
          </div>
          {drive?.archiveContext?.refreshedAt ? (
            <p className="text-xs text-muted-foreground">
              Last context refresh: {drive.archiveContext.refreshedAt}
              {drive.archiveContext.indexPreview
                ? ` — ${drive.archiveContext.indexPreview}`
                : ""}
            </p>
          ) : null}
          {driveNote ? <p className="text-xs text-muted-foreground">{driveNote}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="h-4 w-4 text-primary" />
            Your profile
          </CardTitle>
          <CardDescription>
            How you use PersonAI, plus a short card for specialists and the morning brief.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium tracking-tight">I use this for</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {USAGE_MODE_OPTIONS.map((opt) => {
                const active = normalizeUsageMode(ceo.usageMode) === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setCeo((c) => ({ ...c, usageMode: opt.value as UsageMode }))}
                    className={cn(
                      "rounded-2xl border px-3 py-3 text-left transition-colors",
                      active
                        ? "border-primary bg-primary/5 shadow-elev-1"
                        : "border-border/70 hover:bg-surface-container-high",
                    )}
                  >
                    <p className="text-sm font-semibold tracking-tight">{opt.label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{opt.description}</p>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              New profiles default to Personal — no MWST or business legal tasks are auto-created.
              Existing tasks you already added are kept.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              value={ceo.displayName ?? ""}
              onChange={(e) => setCeo((c) => ({ ...c, displayName: e.target.value }))}
              placeholder="Display name"
            />
            {(normalizeUsageMode(ceo.usageMode) === "BUSINESS" ||
              normalizeUsageMode(ceo.usageMode) === "BOTH") && (
              <Input
                value={ceo.company ?? ""}
                onChange={(e) => setCeo((c) => ({ ...c, company: e.target.value }))}
                placeholder="Company (optional)"
              />
            )}
            <Input
              value={ceo.locale ?? ""}
              onChange={(e) => setCeo((c) => ({ ...c, locale: e.target.value }))}
              placeholder="Locale (e.g. de-CH)"
            />
            <Input
              value={ceo.language ?? ""}
              onChange={(e) => setCeo((c) => ({ ...c, language: e.target.value }))}
              placeholder="Language (e.g. de)"
            />
            <Input
              value={ceo.timezone ?? ""}
              onChange={(e) => setCeo((c) => ({ ...c, timezone: e.target.value }))}
              placeholder="Timezone (e.g. Europe/Zurich)"
            />
            <Input
              value={ceo.briefHour ?? ""}
              onChange={(e) => setCeo((c) => ({ ...c, briefHour: e.target.value }))}
              placeholder="Brief hour (e.g. 07:00)"
            />
          </div>
          <Textarea
            value={ceo.notes ?? ""}
            onChange={(e) => setCeo((c) => ({ ...c, notes: e.target.value }))}
            placeholder="Short standing notes (kept compact in prompts)"
            rows={3}
            className="resize-none"
          />
          <Button onClick={() => void saveCeo()} disabled={ceoSaving}>
            {ceoSaving ? "Saving…" : "Save profile"}
          </Button>
          {ceoNote ? <p className="text-xs text-muted-foreground">{ceoNote}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Brain className="h-4 w-4 text-primary" />
            Memory facts
          </CardTitle>
          <CardDescription>
            Short facts you want remembered. Specialists see the 20 most recently updated.
            Distill scans recent chats for “remember / prefer / live / work” cues and queues
            confirmations before writing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto]">
            <Input
              value={factKey}
              onChange={(e) => setFactKey(e.target.value)}
              placeholder="Label (e.g. preferred bank)"
            />
            <Input
              value={factValue}
              onChange={(e) => setFactValue(e.target.value)}
              placeholder="Details"
            />
            <Button
              onClick={() => void addFact()}
              disabled={factSaving || !factKey.trim() || !factValue.trim()}
            >
              {factSaving ? "…" : "Add"}
            </Button>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void distillFromChats()}
            disabled={distillBusy}
          >
            {distillBusy ? "Scanning…" : "Distill from recent chats"}
          </Button>
          {facts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No facts yet.</p>
          ) : (
            <ul className="space-y-2">
              {facts.map((f) => (
                <li
                  key={f.id ?? f.key}
                  className="flex items-start justify-between gap-3 border-b border-border/60 pb-2 last:border-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{f.key}</p>
                    <p className="break-words text-sm text-muted-foreground">{f.value}</p>
                  </div>
                  {f.id ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      onClick={() => void deleteFact(f.id!)}
                      aria-label={`Delete ${f.key}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {factNote ? <p className="text-xs text-muted-foreground">{factNote}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4 text-primary" />
            Password & encryption
          </CardTitle>
          <CardDescription>
            Argon2id-hashed password unlocks a session token and decrypts this profile&apos;s SQLite
            database (AES-256-GCM). Sign-out re-seals the DB on disk.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {profileName ? (
            <Input
              type="text"
              name="username"
              autoComplete="username"
              value={profileName}
              readOnly
              tabIndex={-1}
              aria-hidden="true"
              className="sr-only"
            />
          ) : null}
          <Input
            type="password"
            name="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Current password"
            autoComplete="current-password"
          />
          <Input
            type="password"
            name="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password (min 8)"
            autoComplete="new-password"
          />
          <Input
            type="password"
            name="new-password-confirm"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
            autoComplete="new-password"
          />
          <Button
            onClick={() => void changePassword()}
            disabled={passwordSaving || !currentPassword || !newPassword}
          >
            {passwordSaving ? "Updating…" : "Change password"}
          </Button>
          {passwordNote ? <p className="text-xs text-muted-foreground">{passwordNote}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4 text-primary" />
            License
          </CardTitle>
        </CardHeader>
        <CardContent>
          {license ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Tier</span>
                <Badge>{license.tier}</Badge>
              </div>
              <ul className="grid grid-cols-2 gap-2 text-sm">
                {Object.entries(license.features).map(([key, enabled]) => (
                  <li key={key} className="flex items-center gap-2">
                    <span className={enabled ? "text-primary" : "text-muted-foreground"}>
                      {enabled ? "✓" : "—"}
                    </span>
                    {key.replace(/([A-Z])/g, " $1").trim()}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Could not load license info.</p>
          )}
        </CardContent>
      </Card>

      <InstallAppCard />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Platform</CardTitle>
        </CardHeader>
        <CardContent>
          <Badge variant="outline">{platform}</Badge>
          <p className="mt-2 text-sm text-muted-foreground">
            Same UI runs in browser, PWA, and Tauri desktop.
          </p>
        </CardContent>
      </Card>
      </div>
    </PageEnter>
  );
}
