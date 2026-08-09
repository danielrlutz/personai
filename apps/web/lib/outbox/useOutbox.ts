"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getOutbox } from "./queue";
import type { OutboxEvent, OutboxOp, OutboxOpType } from "./types";

export function useOutbox(filterType?: OutboxOpType) {
  const [ops, setOps] = useState<OutboxOp[]>([]);

  useEffect(() => {
    const outbox = getOutbox();
    return outbox.subscribe((event: OutboxEvent) => {
      if (event.kind === "changed") {
        setOps(event.ops);
      }
    });
  }, []);

  const visible = useMemo(
    () => (filterType ? ops.filter((op) => op.type === filterType) : ops),
    [ops, filterType],
  );

  const retry = useCallback(async (opId: string) => {
    await getOutbox().retry(opId);
  }, []);

  const dismiss = useCallback(async (opId: string) => {
    await getOutbox().dismiss(opId);
  }, []);

  const pendingCount = visible.filter((op) => op.status !== "failed").length;
  const failedCount = visible.filter((op) => op.status === "failed").length;

  return {
    ops: visible,
    retry,
    dismiss,
    pendingCount,
    failedCount,
    hasWork: visible.length > 0,
  };
}

export function useOutboxEvents(onEvent: (event: OutboxEvent) => void): void {
  useEffect(() => {
    return getOutbox().subscribe(onEvent);
  }, [onEvent]);
}
