"use client";

import { useEffect, useState } from "react";
import { Settings, Server, User, Shield, Cpu } from "lucide-react";
import {
  apiGet,
  apiPut,
  getApiBaseUrl,
  setApiBaseUrl,
  type LicenseInfo,
  type OllamaHealth,
  type ProfileRegistry,
} from "@/lib/api-client";
import { getStoredProfileId, getStoredApiBaseUrl, setStoredApiBaseUrl, getPlatform } from "@/lib/platform";
import { getActiveProfileId, logoutToProfiles } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

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

export default function SettingsPage() {
  const [apiUrl, setApiUrl] = useState("");
  const [license, setLicense] = useState<LicenseInfo | null>(null);
  const [profileName, setProfileName] = useState("");
  const [saved, setSaved] = useState(false);
  const [ollama, setOllama] = useState<OllamaHealth | null>(null);
  const [ollamaHost, setOllamaHost] = useState("");
  const [ollamaNote, setOllamaNote] = useState<string | null>(null);
  const [ollamaSaving, setOllamaSaving] = useState(false);
  const platform = typeof window !== "undefined" ? getPlatform() : "browser";

  const refreshOllama = async () => {
    try {
      const data = await apiGet<OllamaHealth>("/ollama/health");
      setOllama(data);
      setOllamaHost(data.configuredHost ?? data.host ?? "http://127.0.0.1:11434");
    } catch {
      setOllama({ ok: false });
    }
  };

  useEffect(() => {
    setApiUrl(getStoredApiBaseUrl() ?? getApiBaseUrl());
    void apiGet<LicenseInfo>("/license").then(setLicense).catch(() => undefined);
    void apiGet<ProfileRegistry>("/profiles").then((registry) => {
      const id = getActiveProfileId();
      const profile = registry.profiles.find((p) => p.id === id);
      setProfileName(profile?.name ?? "Unknown");
    });
    void refreshOllama();
  }, []);

  const saveApiUrl = () => {
    setStoredApiBaseUrl(apiUrl);
    setApiBaseUrl(apiUrl);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
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

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Settings className="h-6 w-6 text-primary" />
          Settings
        </h1>
        <p className="mt-1 text-muted-foreground">Configure API connection and profile.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Server className="h-4 w-4 text-primary" />
            API Server
          </CardTitle>
          <CardDescription>Node sidecar endpoint (default http://localhost:4000)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} placeholder="http://localhost:4000" />
          <Button onClick={saveApiUrl}>{saved ? "Saved!" : "Save API URL"}</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Cpu className="h-4 w-4 text-primary" />
            Ollama
          </CardTitle>
          <CardDescription>
            Native host install is preferred for desktop. If the API runs in Docker against host Ollama, use
            http://host.docker.internal:11434
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={ollama?.ok ? "default" : "destructive"}>
              {ollama?.ok ? "Reachable" : "Offline"}
            </Badge>
            <Badge variant="outline">{runtimeBadge(ollama?.runtime)}</Badge>
            {ollama?.apiInDocker ? <Badge variant="outline">API in Docker</Badge> : null}
            {ollama?.ok && ollama.models ? (
              <span className="text-xs text-muted-foreground">{ollama.models.length} models</span>
            ) : null}
          </div>
          {ollama?.host ? (
            <p className="text-sm text-muted-foreground">
              Active: <span className="font-mono text-foreground">{ollama.host}</span>
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
            Active Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <div>
            <p className="font-medium">{profileName}</p>
            <p className="text-xs text-muted-foreground font-mono">{getStoredProfileId()}</p>
          </div>
          <Button variant="outline" onClick={() => logoutToProfiles()}>
            Switch profile
          </Button>
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
  );
}
