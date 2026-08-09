"use client";

import { useEffect, useState } from "react";
import { KeyRound, Shield } from "lucide-react";
import { apiGet, apiPut } from "@/lib/api-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type ProductSettings = {
  ollamaHost: string | null;
  visionModel: string | null;
  reasoningModel: string | null;
  architectModel: string | null;
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

/** Settings-first control plane — secrets masked after save; vault wins over .env. */
export function ProductSettingsCard() {
  const [s, setS] = useState<ProductSettings | null>(null);
  const [oauthSecret, setOauthSecret] = useState("");
  const [premiumKey, setPremiumKey] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const data = await apiGet<ProductSettings>("/settings/product", { silent: true });
      setS(data);
    } catch {
      setNote("Could not load product settings vault.");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    if (!s) return;
    setSaving(true);
    setNote(null);
    try {
      const body: Record<string, unknown> = {
        ollamaHost: s.ollamaHost,
        visionModel: s.visionModel,
        reasoningModel: s.reasoningModel,
        architectModel: s.architectModel,
        coderModel: s.coderModel,
        coachingModel: s.coachingModel,
        stylistModel: s.stylistModel,
        qaModel: s.qaModel,
        publicWebUrl: s.publicWebUrl,
        publicApiUrl: s.publicApiUrl,
        googleOauthClientId: s.googleOauthClientId,
        googleOauthRedirectUri: s.googleOauthRedirectUri,
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

  if (!s) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Product vault</CardTitle>
          <CardDescription>Loading encrypted Settings…</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const modelField = (
    label: string,
    key: keyof ProductSettings,
  ) => (
    <label className="space-y-1 text-xs text-muted-foreground">
      {label}
      <Input
        list="personai-known-models"
        value={(s[key] as string) ?? ""}
        onChange={(e) => setS({ ...s, [key]: e.target.value })}
        className="font-mono text-xs"
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
          <label className="space-y-1 text-xs text-muted-foreground sm:col-span-2">
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
          {modelField("Forge coder", "coderModel")}
          {modelField("QA (deepseek-r1)", "qaModel")}
          {modelField("Coaching", "coachingModel")}
          {modelField("Stylist text", "stylistModel")}
          <label className="space-y-1 text-xs text-muted-foreground">
            Public web URL
            <Input
              value={s.publicWebUrl ?? ""}
              onChange={(e) => setS({ ...s, publicWebUrl: e.target.value })}
              placeholder="http://host:3000"
            />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Public API URL
            <Input
              value={s.publicApiUrl ?? ""}
              onChange={(e) => setS({ ...s, publicApiUrl: e.target.value })}
              placeholder="http://host:4000"
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
            placeholder="Redirect URI …/archive/drive/oauth/callback"
            className="font-mono text-xs"
          />
          <div className="flex flex-wrap gap-2">
            {s.googleOauthClientSecretSet ? (
              <Badge variant="outline">Secret configured</Badge>
            ) : (
              <Badge variant="destructive">Secret missing</Badge>
            )}
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-border/70 p-3">
          <p className="text-sm font-medium">Premium / cloud (optional)</p>
          <Input
            type="password"
            value={premiumKey}
            onChange={(e) => setPremiumKey(e.target.value)}
            placeholder={
              s.premiumApiKeySet
                ? `Configured ${s.premiumApiKeyMasked ?? "••••"} — paste to rotate`
                : "Premium API key"
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
        {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      </CardContent>
    </Card>
  );
}
