"use client";

import { useEffect, useState } from "react";
import {
  applyTheme,
  getStoredTheme,
  setStoredTheme,
  type ThemePreference,
} from "@/lib/theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [pref, setPref] = useState<ThemePreference>("system");

  useEffect(() => {
    const initial = getStoredTheme();
    setPref(initial);
    applyTheme(initial);

    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      if (getStoredTheme() === "system") applyTheme("system");
    };
    mq.addEventListener("change", onChange);

    const onStorage = (e: StorageEvent) => {
      if (e.key === "personai.theme") {
        const next = getStoredTheme();
        setPref(next);
        applyTheme(next);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      mq.removeEventListener("change", onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    (window as unknown as { __personaiSetTheme?: (t: ThemePreference) => void }).__personaiSetTheme =
      (t) => {
        setStoredTheme(t);
        setPref(t);
        applyTheme(t);
      };
  }, [pref]);

  return <>{children}</>;
}

export function setThemePreference(theme: ThemePreference): void {
  setStoredTheme(theme);
  applyTheme(theme);
  window.dispatchEvent(new CustomEvent("personai:theme", { detail: { theme } }));
}
