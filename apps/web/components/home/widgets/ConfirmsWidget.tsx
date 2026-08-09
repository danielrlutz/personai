"use client";

import { ConfirmGate } from "@/components/confirm/ConfirmGate";

/** Home widget wrapper — always shows an honest empty state when idle. */
export function ConfirmsWidget() {
  return <ConfirmGate showEmpty />;
}
