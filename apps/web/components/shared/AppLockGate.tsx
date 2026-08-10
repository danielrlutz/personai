"use client";

import { useEffect, useState } from "react";
import { Fingerprint, Lock } from "lucide-react";
import {
  getIdleLockMs,
  isAppLocked,
  isLockEnabled,
  isPasskeyEnabled,
  isPinEnabled,
  isSecureWebAuthnContext,
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
  const [pinOk, setPinOk] = useState(false);
  const [passkeyOk, setPasskeyOk] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);

  useEffect(() => {
    setLocked(isAppLocked());
    setPinOk(isPinEnabled());
    setPasskeyOk(isPasskeyEnabled() && isSecureWebAuthnContext());

    const onLock = (e: Event) => {
      const detail = (e as CustomEvent<{ locked: boolean }>).detail;
      const next = Boolean(detail?.locked);
      setLocked(next);
      setPinOk(isPinEnabled());
      setPasskeyOk(isPasskeyEnabled() && isSecureWebAuthnContext());
      if (next) {
        setPin("");
        setError(null);
      }
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

    return () => {
      window.removeEventListener("personai:app-lock", onLock);
      document.removeEventListener("visibilitychange", onVis);
      for (const ev of events) window.removeEventListener(ev, bump);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!locked || !passkeyOk || pinOk) return;
    // Passkey-only lock: prompt biometrics once when the gate appears.
    let cancelled = false;
    setBioBusy(true);
    void tryBiometricUnlock().then((ok) => {
      if (cancelled) return;
      setBioBusy(false);
      if (ok) {
        setError(null);
        setLocked(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [locked, passkeyOk, pinOk]);

  if (!locked) return <>{children}</>;

  const submitPin = () => {
    void unlockApp(pin).then((ok) => {
      if (!ok) setError("Incorrect PIN");
      else {
        setError(null);
        setPin("");
        setLocked(false);
      }
    });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 p-6 backdrop-blur-md">
      <div className="w-full max-w-sm space-y-4 rounded-2xl border border-border/70 bg-card p-6 shadow-elev-3">
        <div className="flex items-center gap-2">
          <Lock className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold tracking-tight">PersonAI is locked</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          {pinOk
            ? "Enter your PIN or use a passkey to resume. Your profile password still protects the encrypted database."
            : "Use Face ID / fingerprint to resume. Your profile password still protects the encrypted database."}
        </p>
        {pinOk ? (
          <Input
            type="password"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitPin();
            }}
          />
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          {pinOk ? (
            <Button className="flex-1" onClick={submitPin}>
              Unlock
            </Button>
          ) : null}
          {passkeyOk ? (
            <Button
              className={pinOk ? undefined : "flex-1"}
              variant={pinOk ? "outline" : "default"}
              disabled={bioBusy}
              onClick={() => {
                setBioBusy(true);
                void tryBiometricUnlock().then((ok) => {
                  setBioBusy(false);
                  if (!ok) setError("Passkey unlock cancelled or unavailable");
                  else {
                    setError(null);
                    setLocked(false);
                  }
                });
              }}
            >
              <Fingerprint className="mr-1.5 h-4 w-4" />
              {bioBusy ? "Waiting…" : "Passkey"}
            </Button>
          ) : null}
        </div>
        {isPasskeyEnabled() && !isSecureWebAuthnContext() ? (
          <p className="text-xs text-muted-foreground">
            Passkeys need HTTPS (Tailscale Serve). Use your PIN on this HTTP connection.
          </p>
        ) : null}
      </div>
    </div>
  );
}
