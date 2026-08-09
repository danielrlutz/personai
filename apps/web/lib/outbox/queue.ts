import { getProfileId } from "@/lib/api-client";
import {
  idbDeleteBlob,
  idbDeleteOp,
  idbGetOp,
  idbListOps,
  idbPutBlob,
  idbPutOp,
} from "./idb";
import { processOp } from "./processors";
import type {
  IngestUploadPayload,
  OutboxEvent,
  OutboxOp,
  OutboxOpType,
  OutboxPayload,
  TeamChatPayload,
} from "./types";
import { isOpenStatus } from "./types";

type Listener = (event: OutboxEvent) => void;

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function currentProfile(): string {
  return getProfileId() ?? "anon";
}

class OutboxQueue {
  private listeners = new Set<Listener>();
  private ops: OutboxOp[] = [];
  private ready: Promise<void>;
  private draining = false;
  private drainRequested = false;
  private bootstrapped = false;

  constructor() {
    this.ready = this.bootstrap();
  }

  private async bootstrap(): Promise<void> {
    if (typeof window === "undefined") return;
    try {
      const all = await idbListOps();
      // Inflight from a prior page lifetime → failed (recoverable via Retry).
      this.ops = [];
      for (const op of all) {
        if (op.status === "done") {
          await idbDeleteOp(op.id);
          continue;
        }
        if (op.status === "inflight") {
          const recovered: OutboxOp = {
            ...op,
            status: "failed",
            lastError: op.lastError ?? "Interrupted — tap Retry",
            updatedAt: Date.now(),
          };
          await idbPutOp(recovered);
          this.ops.push(recovered);
        } else {
          this.ops.push(op);
        }
      }
      this.bootstrapped = true;
      this.emit({ kind: "changed", ops: this.snapshot() });
      this.attachLifecycle();
      void this.drain();
    } catch {
      this.bootstrapped = true;
      this.ops = [];
      this.emit({ kind: "changed", ops: [] });
    }
  }

  private attachLifecycle(): void {
    window.addEventListener("online", () => void this.drain());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void this.drain();
    });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    if (this.bootstrapped) {
      listener({ kind: "changed", ops: this.snapshot() });
    } else {
      void this.ready.then(() => listener({ kind: "changed", ops: this.snapshot() }));
    }
    return () => this.listeners.delete(listener);
  }

  private emit(event: OutboxEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // listeners must not break the queue
      }
    }
  }

  snapshot(profileId = currentProfile()): OutboxOp[] {
    return this.ops
      .filter((op) => op.profileId === profileId && isOpenStatus(op.status))
      .slice()
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  async whenReady(): Promise<void> {
    await this.ready;
  }

  async enqueue<T extends OutboxOpType>(
    type: T,
    payload: T extends "team-chat"
      ? TeamChatPayload
      : T extends "ingest-upload"
        ? IngestUploadPayload
        : OutboxPayload,
    options?: { blob?: Blob; blobKey?: string; autoProcess?: boolean },
  ): Promise<OutboxOp> {
    await this.ready;
    const now = Date.now();
    const op: OutboxOp = {
      id: newId(type),
      type,
      status: "pending",
      profileId: currentProfile(),
      createdAt: now,
      updatedAt: now,
      attempts: 0,
      payload: payload as OutboxOp["payload"],
    };

    if (type === "ingest-upload" && options?.blob) {
      const p = payload as IngestUploadPayload;
      await idbPutBlob(p.blobKey, options.blob, {
        filename: p.filename,
        mimeType: p.mimeType,
      });
    } else if (type === "team-chat" && options?.blob && options.blobKey) {
      const p = payload as TeamChatPayload;
      await idbPutBlob(options.blobKey, options.blob, {
        filename: p.imageFilename ?? "photo.jpg",
        mimeType: p.imageMimeType ?? "image/jpeg",
      });
    }

    await idbPutOp(op);
    this.ops = [...this.ops.filter((o) => o.id !== op.id), op];
    this.emit({ kind: "changed", ops: this.snapshot() });

    if (options?.autoProcess !== false) {
      void this.drain();
    }
    return op;
  }

  async enqueueUpload(file: File): Promise<OutboxOp> {
    const blobKey = newId("blob");
    return this.enqueue(
      "ingest-upload",
      {
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        blobKey,
      },
      { blob: file },
    );
  }

  async enqueueTeamChat(input: {
    message: string;
    specialist: string;
    sessionId?: string;
    clientMessageId?: string;
    image?: File | Blob;
    imageFilename?: string;
  }): Promise<OutboxOp> {
    const payload: TeamChatPayload = {
      clientMessageId: input.clientMessageId ?? newId("user"),
      message: input.message.trim(),
      specialist: input.specialist,
      sessionId: input.sessionId,
    };
    if (input.image) {
      const blobKey = newId("blob");
      payload.imageBlobKey = blobKey;
      payload.imageMimeType =
        (input.image instanceof File ? input.image.type : input.image.type) ||
        "image/jpeg";
      payload.imageFilename =
        input.imageFilename ||
        (input.image instanceof File ? input.image.name : "photo.jpg");
      return this.enqueue("team-chat", payload, { blob: input.image, blobKey });
    }
    return this.enqueue("team-chat", payload);
  }

  async retry(opId: string): Promise<void> {
    await this.ready;
    const op = this.ops.find((o) => o.id === opId) ?? (await idbGetOp(opId));
    if (!op || op.status === "inflight") return;
    const next: OutboxOp = {
      ...op,
      status: "pending",
      lastError: undefined,
      updatedAt: Date.now(),
    };
    await idbPutOp(next);
    this.ops = this.ops.map((o) => (o.id === opId ? next : o));
    this.emit({ kind: "changed", ops: this.snapshot() });
    void this.drain();
  }

  async dismiss(opId: string): Promise<void> {
    await this.ready;
    const op = this.ops.find((o) => o.id === opId);
    if (!op || op.status === "inflight") return;
    await this.removeOp(op);
    this.emit({ kind: "changed", ops: this.snapshot() });
  }

  /** Drop open team-chat ops for a specialist (e.g. Clear thread). */
  async dismissTeamChat(specialist: string): Promise<void> {
    await this.ready;
    const profileId = currentProfile();
    const targets = this.ops.filter(
      (op) =>
        op.profileId === profileId &&
        op.type === "team-chat" &&
        (op.payload as TeamChatPayload).specialist === specialist &&
        op.status !== "inflight",
    );
    for (const op of targets) {
      await this.removeOp(op);
    }
    this.emit({ kind: "changed", ops: this.snapshot() });
  }

  private async removeOp(op: OutboxOp): Promise<void> {
    if (op.type === "ingest-upload") {
      const blobKey = (op.payload as IngestUploadPayload).blobKey;
      try {
        await idbDeleteBlob(blobKey);
      } catch {
        // ignore
      }
    } else if (op.type === "team-chat") {
      const blobKey = (op.payload as TeamChatPayload).imageBlobKey;
      if (blobKey) {
        try {
          await idbDeleteBlob(blobKey);
        } catch {
          // ignore
        }
      }
    }
    await idbDeleteOp(op.id);
    this.ops = this.ops.filter((o) => o.id !== op.id);
  }

  async drain(): Promise<void> {
    await this.ready;
    if (this.draining) {
      this.drainRequested = true;
      return;
    }
    this.draining = true;
    try {
      do {
        this.drainRequested = false;
        while (true) {
          const profileId = currentProfile();
          const next = this.ops
            .filter((op) => op.profileId === profileId && op.status === "pending")
            .sort((a, b) => a.createdAt - b.createdAt)[0];
          if (!next) break;
          await this.runOne(next.id);
        }
      } while (this.drainRequested);
    } finally {
      this.draining = false;
    }
  }

  /** Wipe all pending ops + blobs (logout / lock). */
  async clearAll(): Promise<void> {
    await this.ready;
    const snapshot = [...this.ops];
    for (const op of snapshot) {
      await this.removeOp(op);
    }
    this.ops = [];
    this.emit({ kind: "changed", ops: [] });
  }

  private async runOne(opId: string): Promise<void> {
    const op = this.ops.find((o) => o.id === opId);
    if (!op || op.status !== "pending") return;

    const inflight: OutboxOp = {
      ...op,
      status: "inflight",
      attempts: op.attempts + 1,
      updatedAt: Date.now(),
      lastError: undefined,
    };
    await idbPutOp(inflight);
    this.ops = this.ops.map((o) => (o.id === opId ? inflight : o));
    this.emit({ kind: "changed", ops: this.snapshot() });

    try {
      await processOp(inflight, (event) => this.emit(event));
      await this.removeOp(inflight);
      this.emit({ kind: "changed", ops: this.snapshot() });
    } catch (err) {
      const { describeApiFailure } = await import("@/lib/api-errors");
      const path = inflight.type === "team-chat" ? "/team/chat/stream" : "/ingest/upload";
      const message = describeApiFailure(err, { path }).message;
      if (inflight.type === "team-chat") {
        this.emit({
          kind: "team-chat-progress",
          opId,
          phase: "failed",
          error: message,
        });
      }
      const failed: OutboxOp = {
        ...inflight,
        status: "failed",
        lastError: message,
        updatedAt: Date.now(),
      };
      await idbPutOp(failed);
      this.ops = this.ops.map((o) => (o.id === opId ? failed : o));
      this.emit({ kind: "changed", ops: this.snapshot() });
    }
  }
}

declare global {
  // Persist singleton across HMR
  // eslint-disable-next-line no-var
  var __personaiOutbox: OutboxQueue | undefined;
}

export function getOutbox(): OutboxQueue {
  if (typeof window === "undefined") {
    // SSR shim — real queue is browser-only
    return {
      subscribe: () => () => undefined,
      snapshot: () => [],
      whenReady: async () => undefined,
      enqueue: async () => {
        throw new Error("Outbox unavailable during SSR");
      },
      enqueueUpload: async () => {
        throw new Error("Outbox unavailable during SSR");
      },
      enqueueTeamChat: async () => {
        throw new Error("Outbox unavailable during SSR");
      },
      retry: async () => undefined,
      dismiss: async () => undefined,
      dismissTeamChat: async () => undefined,
      drain: async () => undefined,
      clearAll: async () => undefined,
    } as unknown as OutboxQueue;
  }
  if (!globalThis.__personaiOutbox) {
    globalThis.__personaiOutbox = new OutboxQueue();
  }
  return globalThis.__personaiOutbox;
}
