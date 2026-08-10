"use client";

import { useEffect, useState } from "react";

/** True below Tailwind `md` (768px) — phone / narrow PWA. */
export function useNarrowViewport(breakpointPx = 768): boolean {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpointPx - 1}px)`);
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [breakpointPx]);

  return narrow;
}
