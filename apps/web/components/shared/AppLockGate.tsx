"use client";

import { useEffect, useState } from "react";
import { Fingerprint, Lock } from "lucide-react";
import {
  getIdleLockMs,
  isAppLocked,
  isLockEnabled,
  lockApp,
  tryBiometricUnlock,
  unlockApp,
} from "@/lib/app-lock";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AppLockGate({ children }: { children: React.ReactNode }) {
  const [locked, setLocked] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [bioAvailable, setBioAvailable] = useState(false);

  useEffect(() => {
    setLocked(isAppLocked());
    const onLock = (e: Event) => {
      const detail = (e as CustomEvent<{ locked: boolean }>).detail;
      setLocked(Boolean(detail?.locked));
    };
    window.addEventListener("personai:app-lock", onLock);

    const onVis = () => {
      if (document.visibilityState === "hidden" && isLockEnabled()) {
        lockApp();
      }
    };
    document.addEventListener("visibilitychange", onVis);

    let last = Date.now();
    const bump = () => {
      last = Date.now();
    };
    const events = ["pointerdown", "keydown", "touchstart"] as const;
    for (const ev of events) window.addEventListener(ev, bump, { passive: true });
    const timer = window.setInterval(() => {
      if (!isLockEnabled() || isAppLocked()) return;
      if (Date.now() - last >= getIdleLockMs()) lockApp();
    }, 15_000);

    void (async () => {
      try {
        const ok =
          typeof PublicKeyCredential !== "undefined" &&
          (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
        setBioAvailable(Boolean(ok));
      } catch {
        setBioAvailable(false);
      }
    })();

    return () => {
      window.removeEventListener("personai:app-lock", onLock);
      document.removeEventListener("visibilitychange", onVis);
      for (const ev of events) window.removeEventListener(ev, bump);
      window.clearInterval(timer);
    };
  }, []);

  if (!locked) return <>{children}</>;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 p-6 backdrop-blur-md">
      <div className="w-full max-w-sm space-y-4 rounded-2xl border border-border/70 bg-card p-6 shadow-elev-3">
        <div className="flex items-center gap-2">
          <Lock className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold tracking-tight">PersonAI is locked</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Enter your PIN to resume. Your profile password still protects the encrypted database.
        </p>
        <Input
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="PIN"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              void unlockApp(pin).then((ok) => {
                if (!ok) setError("Incorrect PIN");
                else {
                  setError(null);
                  setPin("");
                  setLocked(false);
                }
              });
            }
          }}
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button
            className="flex-1"
            onClick={() =>
              void unlockApp(pin).then((ok) => {
                if (!ok) setError("Incorrect PIN");
                else {
                  setError(null);
                  setPin("");
                  setLocked(false);
                }
              })
            }
          >
            Unlock
          </Button>
          {bioAvailable ? (
            <Button
              variant="outline"
              onClick={() =>
                void tryBiometricUnlock().then((ok) => {
                  if (!ok) setError("Biometric unlock unavailable");
                  else {
                    setError(null);
                    setLocked(false);
                  }
                })
              }
            >
              <Fingerprint className="mr-1.5 h-4 w-4" />
              Biometric
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
