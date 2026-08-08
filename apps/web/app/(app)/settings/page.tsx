"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Settings, Server, User, Shield } from "lucide-react";
import {
  apiGet,
  getApiBaseUrl,
  setApiBaseUrl,
  type LicenseInfo,
  type ProfileRegistry,
} from "@/lib/api-client";
import { getStoredProfileId, getStoredApiBaseUrl, setStoredApiBaseUrl, clearStoredProfileId } from "@/lib/platform";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { getPlatform } from "@/lib/platform";

export default function SettingsPage() {
  const router = useRouter();
  const [apiUrl, setApiUrl] = useState("");
  const [license, setLicense] = useState<LicenseInfo | null>(null);
  const [profileName, setProfileName] = useState("");
  const [saved, setSaved] = useState(false);
  const platform = typeof window !== "undefined" ? getPlatform() : "browser";

  useEffect(() => {
    setApiUrl(getStoredApiBaseUrl() ?? getApiBaseUrl());
    void apiGet<LicenseInfo>("/license").then(setLicense).catch(() => undefined);
    void apiGet<ProfileRegistry>("/profiles").then((registry) => {
      const id = getStoredProfileId();
      const profile = registry.profiles.find((p) => p.id === id);
      setProfileName(profile?.name ?? "Unknown");
    });
  }, []);

  const saveApiUrl = () => {
    setStoredApiBaseUrl(apiUrl);
    setApiBaseUrl(apiUrl);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const switchProfile = () => {
    clearStoredProfileId();
    router.push("/profiles");
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Settings className="h-6 w-6 text-teal-400" />
          Settings
        </h1>
        <p className="mt-1 text-muted-foreground">Configure API connection and profile.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Server className="h-4 w-4 text-teal-400" />
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
            <User className="h-4 w-4 text-teal-400" />
            Active Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <div>
            <p className="font-medium">{profileName}</p>
            <p className="text-xs text-muted-foreground font-mono">{getStoredProfileId()}</p>
          </div>
          <Button variant="outline" onClick={switchProfile}>
            Switch profile
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4 text-teal-400" />
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
                    <span className={enabled ? "text-teal-400" : "text-muted-foreground"}>
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
