"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, MonitorSmartphone, ShieldAlert, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  type BeforeInstallPromptEvent,
  type PwaInstallStatus,
  httpsEnableCommand,
  isSecureInstallContext,
  isStandaloneDisplay,
  suggestedHttpsApiUrl,
  suggestedHttpsWebUrl,
} from "@/lib/pwa-install";

export function InstallAppCard() {
  const [status, setStatus] = useState<PwaInstallStatus>("listening");
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const httpsWeb = suggestedHttpsWebUrl();
  const httpsApi = suggestedHttpsApiUrl();
  const enableCmd = httpsEnableCommand();

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (isStandaloneDisplay()) {
      setStatus("installed");
      return;
    }

    if (!isSecureInstallContext()) {
      setStatus("insecure");
      return;
    }

    if (!("serviceWorker" in navigator)) {
      setStatus("unsupported");
      return;
    }

    const onBip = (event: Event) => {
      event.preventDefault();
      const bip = event as BeforeInstallPromptEvent;
      setDeferred(bip);
      setStatus("installable");
      setNote(null);
    };

    const onInstalled = () => {
      setDeferred(null);
      setStatus("installed");
      setNote("PersonAI was installed on this device.");
    };

    window.addEventListener("beforeinstallprompt", onBip);
    window.addEventListener("appinstalled", onInstalled);

    // Give Chrome time to evaluate installability after SW activates.
    const timer = window.setTimeout(() => {
      setStatus((prev) => {
        if (prev === "listening") return "blocked";
        return prev;
      });
    }, 8000);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
      window.clearTimeout(timer);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferred) return;
    setBusy(true);
    setNote(null);
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") {
        setStatus("installed");
        setNote("Install accepted — PersonAI should appear on your home screen / app list.");
      } else {
        setNote("Install dismissed. You can try again from Chrome ⋮ → Install app.");
        setStatus("installable");
      }
    } catch {
      setNote("Install prompt failed. Try Chrome ⋮ → Install app.");
    } finally {
      setDeferred(null);
      setBusy(false);
    }
  }, [deferred]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MonitorSmartphone className="h-4 w-4 text-primary" />
          Install app
        </CardTitle>
        <CardDescription>
          Install PersonAI as a real PWA (standalone window), not just a browser shortcut.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Status</span>
          <StatusBadge status={status} />
        </div>

        {status === "installable" ? (
          <>
            <p className="text-sm text-muted-foreground">
              Chrome is ready to install PersonAI. Use the button below (or Chrome ⋮ → Install app).
            </p>
            <Button onClick={() => void install()} disabled={busy || !deferred}>
              <Download className="h-4 w-4" />
              {busy ? "Opening prompt…" : "Install app"}
            </Button>
          </>
        ) : null}

        {status === "installed" ? (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            Running as an installed app, or already on this device.
          </p>
        ) : null}

        {status === "listening" ? (
          <p className="text-sm text-muted-foreground">Checking whether this browser can install PersonAI…</p>
        ) : null}

        {status === "insecure" ? (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              You are on plain HTTP. Chrome will only offer “Add shortcut” here — that is not a PWA.
              Open the HTTPS Tailscale Serve URL instead.
            </p>
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>
                On the VPS, enable Serve:
                {enableCmd ? (
                  <>
                    {" "}
                    <code className="break-all text-foreground">{enableCmd}</code>
                  </>
                ) : (
                  <>
                    {" "}
                    <code className="text-foreground">HTTPS=1 ./scripts/vps-tailscale.sh &lt;host&gt;</code>
                  </>
                )}
              </li>
              <li>
                On your phone, open{" "}
                <code className="break-all text-foreground">{httpsWeb ?? "https://&lt;magicdns-host&gt;/"}</code>
                {" "}
                (HTTPS on port 443 — not <code className="text-foreground">http://…:3000</code>).
              </li>
              <li>
                In Settings, set API URL to{" "}
                <code className="break-all text-foreground">{httpsApi ?? "https://&lt;magicdns-host&gt;:8443"}</code>
                {" "}
                if it is not already baked in.
              </li>
              <li>Return here — Install app appears when Chrome fires beforeinstallprompt.</li>
            </ol>
          </div>
        ) : null}

        {status === "blocked" ? (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              No install prompt yet. The page is secured, but Chrome has not marked the app installable
              (or it was dismissed earlier).
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Use Chrome / Edge (not in-app browsers).</li>
              <li>Confirm you opened the HTTPS URL (https://…), not http://…:3000.</li>
              <li>Check ⋮ menu for “Install app” / “Install PersonAI”.</li>
              <li>If you previously chose “Add shortcut”, remove that shortcut and reload.</li>
              <li>Clear site data for this origin, reload, then wait a few seconds for the service worker.</li>
            </ul>
          </div>
        ) : null}

        {status === "unsupported" ? (
          <p className="text-sm text-muted-foreground">
            This browser does not support service workers / PWA install. Try Chrome or Edge on Android /
            desktop.
          </p>
        ) : null}

        {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: PwaInstallStatus }) {
  switch (status) {
    case "installable":
      return <Badge>Ready to install</Badge>;
    case "installed":
      return <Badge variant="outline">Installed</Badge>;
    case "insecure":
      return <Badge variant="outline">Needs HTTPS</Badge>;
    case "blocked":
      return <Badge variant="outline">No prompt yet</Badge>;
    case "unsupported":
      return <Badge variant="outline">Unsupported</Badge>;
    default:
      return <Badge variant="outline">Checking…</Badge>;
  }
}
