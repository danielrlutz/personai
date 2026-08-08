"use client";

import { useLayoutEffect, useState } from "react";
import { isTauriRuntime, syncTauriApiBaseUrl } from "@/lib/tauri";

/**
 * In Tauri, resolve the sidecar API base URL before children fetch.
 * Browser/PWA skips the gate entirely (default localhost:4000).
 */
export function ApiBootstrap({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(() => {
    if (typeof window === "undefined") return true;
    return !isTauriRuntime();
  });

  useLayoutEffect(() => {
    if (ready) return;

    let cancelled = false;
    const started = Date.now();

    const resolve = async () => {
      const base = await syncTauriApiBaseUrl();
      if (cancelled) return;
      if (base || Date.now() - started > 1500 || !isTauriRuntime()) {
        setReady(true);
        return;
      }
      window.setTimeout(() => {
        void resolve();
      }, 25);
    };

    void resolve();
    return () => {
      cancelled = true;
    };
  }, [ready]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return <>{children}</>;
}
