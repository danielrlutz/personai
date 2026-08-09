"use client";

import { useEffect } from "react";

/**
 * Registers the root-scoped service worker required for Chrome installability.
 * Works with Next static export served by nginx (`/sw.js` in `public/`).
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
        // Check for updates on load (nginx serves sw.js with no-cache).
        void reg.update();
      } catch {
        /* optional offline shell — install UI surfaces secure-context issues */
      }
    };

    void register();
  }, []);

  return null;
}
