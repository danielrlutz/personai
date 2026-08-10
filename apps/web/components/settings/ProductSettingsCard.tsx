"use client";

import { useEffect, useState } from "react";
import { KeyRound, Shield } from "lucide-react";
import {
  apiGet,
  apiPut,
  getApiBaseUrl,
  getHttpFallbackApiBaseUrl,
  getHttpFallbackSettingsUrl,
  getSuggestedApiBaseUrl,
  preferReachableApiBaseUrl,
  probeApiHealth,
  setApiBaseUrl,
} from "@/lib/api-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type ProductSettings = {
  ollamaHost: string | null;
  visionModel: string | null;
  reasoningModel: string | null;
  architectModel: string | null;
  reinspectModel: string | null;
  coderModel: string | null;
  coachingModel: string | null;
  stylistModel: string | null;
  qaModel: string | null;
  suggestedModels: string[];
  publicWebUrl: string | null;
  publicApiUrl: string | null;
  googleOauthClientId: string | null;
  googleOauthClientSecretSet: boolean;
  googleOauthClientSecretMasked: string | null;
  googleOauthRedirectUri: string | null;
  googleDriveRootFolderId: string | null;
  premiumApiKeySet: boolean;
  premiumApiKeyMasked: string | null;
  premiumMonthlyQuota: number;
  source: { ollamaHost: string; googleOauth: string };
};

function httpsOauthRedirect(apiBase: string | null | undefined): string | null {
  const base = (apiBase ?? "").replace(/\/$/, "");
  if (!base.startsWith("https:")) return null;
  return `${base}/archive/drive/oauth/callback`;
}

/** Settings-first control plane — secrets masked after save; vault wins over .env. */
export function ProductSettingsCard() {
  const [s, setS] = useState<ProductSettings | null>(null);
  const [oauthSecret, setOauthSecret] = useState("");
  const [premiumKey, setPremiumKey] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fallbackBusy, setFallbackBusy] = useState(false);

  const load = async (opts?: { skipPrefer?: boolean }) => {
    setLoading(true);
    setLoadError(null);
    if (!opts?.skipPrefer) setNote(null);
    try {
      if (!opts?.skipPrefer) {
        const prefer = await preferReachableApiBaseUrl();
        if (prefer.switched) {
          setNote(prefer.reason ?? `Switched API to ${prefer.baseUrl}. Reloading…`);
          window.setTimeout(() => window.location.reload(), 400);
          return;
        }
        if (prefer.needsHttpUi && prefer.reason) {
          // Still attempt load (will fail); surface Serve / HTTP UI guidance below.
          setLoadError(prefer.reason);
        }
      }
      const data = await apiGet<ProductSettings>("/settings/product", { silent: true });
      const httpsRedirect = httpsOauthRedirect(data.publicApiUrl ?? getSuggestedApiBaseUrl());
      if (
        httpsRedirect &&
        (!data.googleOauthRedirectUri || data.googleOauthRedirectUri.startsWith("http:"))
      ) {
        data.googleOauthRedirectUri = httpsRedirect;
      }
      setS(data);
      setLoadError(null);
    } catch (err) {
      setS(null);
      const msg = err instanceof Error ? err.message : "Could not load product settings vault.";
      const active = getApiBaseUrl();
      const httpFallback = getHttpFallbackApiBaseUrl();
      const httpSettings = getHttpFallbackSettingsUrl();
      if (active.startsWith("https:") || httpSettings) {
        setLoadError(
          `${msg} Active API ${active} is unreachable — often Tailscale Serve has no config ` +
            `(\`tailscale serve status\` → No serve config). ` +
            (httpSettings
              ? `Switch API URL: open ${httpSettings} and use ${httpFallback} (browse-only, not PWA).`
              : `Set Settings → API Server to ${httpFallback ?? "http://HOST:4000"}.`),
        );
      } else if (httpFallback && active !== httpFallback) {
        setLoadError(`${msg} Try switching API URL to ${httpFallback}.`);
      } else {
        setLoadError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const tryHttpFallback = async () => {
    const httpApi = getHttpFallbackApiBaseUrl();
    const httpSettings = getHttpFallbackSettingsUrl();
    if (!httpApi) return;
    setFallbackBusy(true);
    setNote(null);
    try {
      // From an HTTPS page, browsers block http:// API (mixed content) — navigate to HTTP UI.
      if (typeof window !== "undefined" && window.location.protocol === "https:" && httpSettings) {
        setLoadError(
          `Cannot call ${httpApi} from this HTTPS page (mixed content). Opening HTTP Settings…`,
        );
        window.location.href = httpSettings;
        return;
      }
      const probe = await probeApiHealth(httpApi);
      if (!probe.ok) {
        setLoadError(
          `HTTP API ${httpApi} also failed (${probe.error ?? "unreachable"}). Fix Serve or docker compose on the VPS.`,
        );
        return;
      }
      setApiBaseUrl(httpApi);
      setLoadError(null);
      setNote(`Switched API to ${httpApi}. Reloading…`);
      window.setTimeout(() => window.location.reload(), 400);
    } finally {
      setFallbackBusy(false);
    }
  };

  const save = async () => {
    if (!s) return;
    setSaving(true);
    setNote(null);
    try {
      const httpsRedirect = httpsOauthRedirect(s.publicApiUrl);
      const redirectUri =
        httpsRedirect &&
        (!s.googleOauthRedirectUri?.trim() || s.googleOauthRedirectUri.startsWith("http:"))
          ? httpsRedirect
          : s.googleOauthRedirectUri;

      const body: Record<string, unknown> = {
        ollamaHost: s.ollamaHost,
        visionModel: s.visionModel,
        reasoningModel: s.reasoningModel,
        architectModel: s.architectModel,
        reinspectModel: s.reinspectModel,
        coderModel: s.coderModel,
        coachingModel: s.coachingModel,
        stylistModel: s.stylistModel,
        qaModel: s.qaModel,
        publicWebUrl: s.publicWebUrl,
        publicApiUrl: s.publicApiUrl,
        googleOauthClientId: s.googleOauthClientId,
        googleOauthRedirectUri: redirectUri,
        googleDriveRootFolderId: s.googleDriveRootFolderId,
        premiumMonthlyQuota: s.premiumMonthlyQuota,
      };
      if (oauthSecret.trim() && !oauthSecret.startsWith("••••")) {
        body.googleOauthClientSecret = oauthSecret.trim();
      }
      if (premiumKey.trim() && !premiumKey.startsWith("••••")) {
        body.premiumApiKey = premiumKey.trim();
      }
      const next = await apiPut<ProductSettings>("/settings/product", body);
      setS(next);
      setOauthSecret("");
      setPremiumKey("");
      setNote("Saved to encrypted host vault. Secrets are never shown plain again.");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading && !s) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Product vault</CardTitle>
          <CardDescription>Loading encrypted Settings…</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!s) {
    const httpSettings = getHttpFallbackSettingsUrl();
    const httpApi = getHttpFallbackApiBaseUrl();
    const onHttps =
      typeof window !== "undefined" && window.location.protocol === "https:";
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4 text-destructive" />
            Product vault
          </CardTitle>
          <CardDescription>Could not load encrypted Settings</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-destructive">{loadError ?? "API unreachable."}</p>
          <p className="text-xs text-muted-foreground">
            Active API: <span className="font-mono text-foreground">{getApiBaseUrl()}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={fallbackBusy} onClick={() => void load()}>
              Retry
            </Button>
            {httpApi ? (
              <Button
                type="button"
                variant="outline"
                disabled={fallbackBusy}
                onClick={() => void tryHttpFallback()}
              >
                {fallbackBusy
                  ? "Trying…"
                  : onHttps
                    ? "Switch API URL (open HTTP Settings)"
                    : "Switch API URL (:4000)"}
              </Button>
            ) : null}
          </div>
          {onHttps && httpSettings ? (
            <p className="text-xs text-muted-foreground">
              Workaround (Drive setup only, not Install app):{" "}
              <a className="font-mono text-primary underline" href={httpSettings}>
                {httpSettings}
              </a>{" "}
              with API{" "}
              <span className="font-mono text-foreground">{httpApi}</span>.
            </p>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  const modelField = (
    label: string,
    key: keyof ProductSettings,
  ) => (
    <label className="space-y-1.5 text-sm text-muted-foreground">
      {label}
      <Input
        list="personai-known-models"
        value={(s[key] as string) ?? ""}
        onChange={(e) => setS({ ...s, [key]: e.target.value })}
        className="font-mono text-sm"
      />
    </label>
  );

  return (
    <Card id="product-vault">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Shield className="h-4 w-4 text-primary" />
          Product vault
        </CardTitle>
        <CardDescription>
          Day-to-day config lives here — not in <span className="font-mono">.env</span>. OAuth /
          premium keys are write-once and masked. Source: Ollama {s.source.ollamaHost}, Google{" "}
          {s.source.googleOauth}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <datalist id="personai-known-models">
          {(s.suggestedModels ?? []).map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm text-muted-foreground sm:col-span-2">
            Ollama host
            <Input
              value={s.ollamaHost ?? ""}
              onChange={(e) => setS({ ...s, ollamaHost: e.target.value })}
              placeholder="http://127.0.0.1:11434"
            />
          </label>
          {modelField("Vision / OCR", "visionModel")}
          {modelField("Reasoning (Staff/CFO/Legal/Medical)", "reasoningModel")}
          {modelField("Architect", "architectModel")}
          {modelField("Reinspect (closer inspection)", "reinspectModel")}
          {modelField("Forge coder", "coderModel")}
          {modelField("QA (deepseek-r1)", "qaModel")}
          {modelField("Coaching", "coachingModel")}
          {modelField("Stylist text", "stylistModel")}
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Flag for closer inspection uses vault Vision plus the Reinspect tier (default{" "}
            <span className="font-mono">deepseek-r1:14b</span>).
          </p>
          <label className="space-y-1.5 text-sm text-muted-foreground">
            Public web URL
            <Input
              value={s.publicWebUrl ?? ""}
              onChange={(e) => setS({ ...s, publicWebUrl: e.target.value })}
              placeholder="https://host or http://host:3000"
            />
          </label>
          <label className="space-y-1.5 text-sm text-muted-foreground">
            Public API URL
            <Input
              value={s.publicApiUrl ?? ""}
              onChange={(e) => {
                const publicApiUrl = e.target.value;
                const httpsRedirect = httpsOauthRedirect(publicApiUrl);
                setS({
                  ...s,
                  publicApiUrl,
                  ...(httpsRedirect ? { googleOauthRedirectUri: httpsRedirect } : {}),
                });
              }}
              placeholder="https://host:8443 or http://host:4000"
            />
          </label>
        </div>

        <div className="space-y-3 rounded-xl border border-border/70 p-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <KeyRound className="h-4 w-4" />
            Google OAuth (paste once)
          </p>
          <Input
            value={s.googleOauthClientId ?? ""}
            onChange={(e) => setS({ ...s, googleOauthClientId: e.target.value })}
            placeholder="Client ID"
            autoCapitalize="none"
          />
          <Input
            type="password"
            value={oauthSecret}
            onChange={(e) => setOauthSecret(e.target.value)}
            placeholder={
              s.googleOauthClientSecretSet
                ? `Configured ${s.googleOauthClientSecretMasked ?? "••••"} — paste to rotate`
                : "Client secret"
            }
            autoComplete="new-password"
          />
          <Input
            value={s.googleOauthRedirectUri ?? ""}
            onChange={(e) => setS({ ...s, googleOauthRedirectUri: e.target.value })}
            placeholder="https://HOST:8443/archive/drive/oauth/callback"
            className="font-mono text-sm"
          />
          <div className="flex flex-wrap gap-2">
            {s.googleOauthClientSecretSet ? (
              <Badge variant="outline">Secret configured</Badge>
            ) : (
              <Badge variant="destructive">Secret missing</Badge>
            )}
            {s.publicApiUrl?.startsWith("https:") ? (
              <Badge variant="outline">HTTPS redirect required</Badge>
            ) : null}
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-dashed border-border/70 p-3">
          <p className="text-sm font-medium">Premium / cloud (optional · advanced)</p>
          <p className="text-xs text-muted-foreground">
            Not required for daily use. Local Ollama is the default brain — cloud spend only after
            confirm-gated quota checks. Leave blank if you do not use premium inference.
          </p>
          <Input
            type="password"
            value={premiumKey}
            onChange={(e) => setPremiumKey(e.target.value)}
            placeholder={
              s.premiumApiKeySet
                ? `Configured ${s.premiumApiKeyMasked ?? "••••"} — paste to rotate`
                : "Premium API key (optional)"
            }
            autoComplete="new-password"
          />
          <Input
            type="number"
            value={s.premiumMonthlyQuota}
            onChange={(e) => setS({ ...s, premiumMonthlyQuota: Number(e.target.value) || 0 })}
            placeholder="Monthly quota"
          />
        </div>

        <Button onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save product vault"}
        </Button>
        {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
      </CardContent>
    </Card>
  );
}
