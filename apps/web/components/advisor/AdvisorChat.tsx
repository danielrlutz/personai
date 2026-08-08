"use client";

import { TeamChat } from "@/components/team/TeamChat";

/** @deprecated Prefer TeamChat — kept as thin alias for finance/advisor deep links. */
export function AdvisorChat() {
  return <TeamChat initialSpecialist="cfo" />;
}
