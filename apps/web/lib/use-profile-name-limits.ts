"use client";

import { useEffect, useState } from "react";
import { apiGet, type ProfileRegistry } from "@/lib/api-client";
import {
  DEFAULT_PROFILE_NAME_LIMITS,
  profileNameSlotWidthStyle,
  type ProfileNameLimits,
} from "@/lib/profile-name-limits";

export function useProfileNameLimits(): ProfileNameLimits {
  const [limits, setLimits] = useState<ProfileNameLimits>(DEFAULT_PROFILE_NAME_LIMITS);

  useEffect(() => {
    let cancelled = false;
    void apiGet<ProfileRegistry>("/profiles", { silent: true })
      .then((registry) => {
        if (!cancelled && registry.nameLimits) setLimits(registry.nameLimits);
      })
      .catch(() => {
        /* keep defaults */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return limits;
}

export { profileNameSlotWidthStyle };
