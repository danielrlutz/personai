"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Brain, HardDrive, CheckCircle2, User } from "lucide-react";
import {
  apiGet,
  apiPut,
  type CeoProfile,
  type DriveStatus,
  type OllamaHealth,
} from "@/lib/api-client";
import { markSetupComplete } from "@/lib/setup-wizard";
import { ARCHIVE_TAXONOMY_CLIENT } from "@/lib/archive-taxonomy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageEnter } from "@/components/motion/PageEnter";
import { cn } from "@/lib/utils";

const STEPS = [
  { id: "identity", label: "Identity", icon: User },
  { id: "ollama", label: "Local AI", icon: Brain },
  { id: "google", label: "Google", icon: HardDrive },
  { id: "taxonomy", label: "Archive", icon: HardDrive },
  { id: "notifications", label: "Alerts", icon: Bell },
] as const;

export default function SetupWizardPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [displayName, setDisplayName] = useState("");
  const [timezone, setTimezone] = useState("Europe/Zurich");
  const [briefHour, setBriefHour] = useState("7");
  const [ollama, setOllama] = useState<OllamaHealth | null>(null);
  const [drive, setDrive] = useState<DriveStatus | null>(null);
  const [notifyOk, setNotifyOk] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void apiGet<CeoProfile>("/ceo-profile", { silent: true })
      .then((ceo) => {
        if (ceo.displayName) setDisplayName(ceo.displayName);
        if (ceo.timezone) setTimezone(ceo.timezone);
        if (ceo.briefHour) setBriefHour(ceo.briefHour);
      })
      .catch(() => undefined);
    void apiGet<OllamaHealth>("/ollama/health", { silent: true })
      .then(setOllama)
      .catch(() => undefined);
    void apiGet<DriveStatus>("/archive/drive", { silent: true })
      .then(setDrive)
      .catch(() => undefined);
  }, []);

  const finish = () => {
    markSetupComplete();
    router.replace("/dashboard/");
  };

  const saveIdentity = async () => {
    setSaving(true);
    setNote(null);
    try {
      await apiPut("/ceo-profile", {
        displayName: displayName.trim() || null,
        timezone: timezone.trim() || "Europe/Zurich",
        briefHour: briefHour.trim() || "7",
        locale: "de-CH",
      });
      setStep(1);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not save identity");
    } finally {
      setSaving(false);
    }
  };

  const requestNotify = async () => {
    if (!("Notification" in window)) {
      setNotifyOk(false);
      setNote("This browser does not support notifications.");
      return;
    }
    const result = await Notification.requestPermission();
    setNotifyOk(result === "granted");
  };

  const current = STEPS[step]!;

  return (
    <PageEnter className="mx-auto w-full max-w-2xl space-y-4 sm:space-y-5">
      <div className="page-header">
        <h1 className="page-title">First-launch setup</h1>
        <p className="page-subtitle">
          One product for desktop and phone — identity, local AI, Drive taxonomy, and morning brief
          (Zurich default).
        </p>
      </div>

      <ol className="flex flex-wrap gap-2">
        {STEPS.map((s, i) => (
          <li
            key={s.id}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium",
              i === step
                ? "bg-primary text-primary-foreground"
                : i < step
                  ? "bg-secondary text-secondary-foreground"
                  : "bg-surface-container text-muted-foreground",
            )}
          >
            {s.label}
          </li>
        ))}
      </ol>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <current.icon className="h-4 w-4 text-primary" />
            {current.label}
          </CardTitle>
          <CardDescription>
            {step === 0 && "Who this profile is for, and when the morning brief should run."}
            {step === 1 && "PersonAI prefers local Ollama. Brains-offline is shown clearly if unreachable."}
            {step === 2 && "Optional — link Google Drive for cloud archive copies (confirm still required)."}
            {step === 3 && "Taxonomy folders 01–10. Local archive always works; Drive is optional."}
            {step === 4 && "Optional browser notifications for Fristen and pending confirms."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {note ? <p className="text-sm text-destructive">{note}</p> : null}

          {step === 0 ? (
            <div className="space-y-3">
              <Input
                placeholder="Display name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
              <Input
                placeholder="Timezone (e.g. Europe/Zurich)"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              />
              <Input
                placeholder="Brief hour (0–23)"
                value={briefHour}
                onChange={(e) => setBriefHour(e.target.value)}
              />
              <Button disabled={saving} onClick={() => void saveIdentity()}>
                Continue
              </Button>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="space-y-3">
              <p className="text-sm">
                Ollama:{" "}
                <span className={ollama?.ok ? "text-success" : "text-destructive"}>
                  {ollama?.ok ? "Reachable" : "Offline / unreachable"}
                </span>
                {ollama?.host ? (
                  <span className="ml-2 text-muted-foreground">({ollama.host})</span>
                ) : null}
              </p>
              <p className="text-xs text-muted-foreground">
                You can change the host anytime in Settings. Premium/cloud inference needs quota +
                confirm.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep(0)}>
                  Back
                </Button>
                <Button onClick={() => setStep(2)}>Continue</Button>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-3">
              <p className="text-sm">
                Drive:{" "}
                {drive?.linked ? (
                  <span className="text-success">Linked</span>
                ) : (
                  <span className="text-muted-foreground">Not linked yet</span>
                )}
              </p>
              <Button variant="outline" asChild>
                <a href="/settings/?focus=drive">Open Drive settings</a>
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button onClick={() => setStep(3)}>Continue</Button>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-3">
              <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
                {Object.entries(ARCHIVE_TAXONOMY_CLIENT).map(([n, label]) => (
                  <li key={n} className="rounded-lg bg-surface-container/70 px-3 py-2">
                    <span className="font-mono text-xs text-muted-foreground">
                      {String(n).padStart(2, "0")}
                    </span>{" "}
                    {label}
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep(2)}>
                  Back
                </Button>
                <Button onClick={() => setStep(4)}>Continue</Button>
              </div>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="space-y-3">
              <Button variant="outline" onClick={() => void requestNotify()}>
                {notifyOk === true ? (
                  <>
                    <CheckCircle2 className="mr-1.5 h-4 w-4" />
                    Notifications allowed
                  </>
                ) : (
                  "Allow notifications"
                )}
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep(3)}>
                  Back
                </Button>
                <Button onClick={finish}>Finish setup</Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </PageEnter>
  );
}
