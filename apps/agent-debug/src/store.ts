import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import type {
  AckReason,
  ArchiveData,
  ArchivedBatch,
  ArchivedMessage,
  Batch,
  BatchState,
  DeployStatus,
  InboxMessage,
  Session,
  StoreData,
} from "./types.js";

function emptyStore(): StoreData {
  return { version: 2, sessions: [], messages: [], batches: [] };
}

function emptyArchive(): ArchiveData {
  return { version: 1, batches: [], messages: [] };
}

type LegacyStoreV1 = {
  version: 1;
  sessions: Session[];
  messages: InboxMessage[];
  batches: Array<
    Omit<Batch, "dispatchedAt" | "ackReason"> & {
      dispatchedAt?: string | null;
      ackReason?: AckReason | null;
    }
  >;
};

function normalizeBatch(
  batch: LegacyStoreV1["batches"][number],
): Batch {
  return {
    ...batch,
    composedAt: (batch as Batch).composedAt ?? (batch as Batch).readyAt ?? null,
    dispatchedAt: batch.dispatchedAt ?? null,
    ackReason: batch.ackReason ?? null,
    cursorAgentId: (batch as Batch).cursorAgentId ?? null,
    cursorRunId: (batch as Batch).cursorRunId ?? null,
    deployStatus: (batch as Batch).deployStatus ?? "none",
    deployNote: (batch as Batch).deployNote ?? null,
    deployedAt: (batch as Batch).deployedAt ?? null,
  };
}

export class JsonStore {
  private data: StoreData = emptyStore();
  private archive: ArchiveData = emptyArchive();
  private writeChain: Promise<void> = Promise.resolve();
  private archiveChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath = config.storePath,
    private readonly archivePath = config.archivePath,
  ) {}

  async init(): Promise<void> {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.mkdirSync(config.uploadsDir, { recursive: true });
    fs.mkdirSync(config.thumbsDir, { recursive: true });

    if (fs.existsSync(this.archivePath)) {
      const raw = fs.readFileSync(this.archivePath, "utf8");
      this.archive = JSON.parse(raw) as ArchiveData;
    } else {
      this.archive = emptyArchive();
      await this.persistArchive();
    }

    if (fs.existsSync(this.filePath)) {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as StoreData | LegacyStoreV1;
      if (parsed.version === 1) {
        this.data = {
          version: 2,
          sessions: parsed.sessions,
          messages: parsed.messages,
          batches: parsed.batches.map(normalizeBatch),
        };
      } else {
        this.data = {
          version: 2,
          sessions: parsed.sessions,
          messages: parsed.messages,
          batches: parsed.batches.map((b) => ({
            ...b,
            composedAt: b.composedAt ?? b.readyAt ?? null,
            dispatchedAt: b.dispatchedAt ?? null,
            ackReason: b.ackReason ?? null,
            cursorAgentId: b.cursorAgentId ?? null,
            cursorRunId: b.cursorRunId ?? null,
            deployStatus: b.deployStatus ?? "none",
            deployNote: b.deployNote ?? null,
            deployedAt: b.deployedAt ?? null,
          })),
        };
      }
      await this.migrateAckedToArchive();
      await this.persist();
    } else {
      this.data = emptyStore();
      await this.persist();
    }
  }

  /** Move legacy in-store acked rows into archive.json on startup. */
  private async migrateAckedToArchive(): Promise<void> {
    const ackedBatches = this.data.batches.filter((b) => b.state === "acked");
    if (!ackedBatches.length) return;

    const now = new Date().toISOString();
    for (const batch of ackedBatches) {
      const reason = batch.ackReason ?? "implemented";
      const ackedAt = batch.ackedAt ?? now;
      this.archive.batches.push({
        ...batch,
        ackReason: reason,
        ackedAt,
      });
      for (const mid of batch.messageIds) {
        const msg = this.getMessage(mid);
        if (msg) {
          this.archive.messages.push({
            ...msg,
            status: "acked",
            ackReason: reason,
            ackedAt,
          });
        }
      }
    }

    const ackedIds = new Set(ackedBatches.map((b) => b.id));
    const ackedMsgIds = new Set(ackedBatches.flatMap((b) => b.messageIds));
    this.data.batches = this.data.batches.filter((b) => !ackedIds.has(b.id));
    this.data.messages = this.data.messages.filter((m) => !ackedMsgIds.has(m.id));
    await this.persistArchive();
  }

  private persist(): Promise<void> {
    this.writeChain = this.writeChain.then(() => {
      const tmp = `${this.filePath}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), "utf8");
      fs.renameSync(tmp, this.filePath);
    });
    return this.writeChain;
  }

  private persistArchive(): Promise<void> {
    this.archiveChain = this.archiveChain.then(() => {
      const tmp = `${this.archivePath}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.archive, null, 2), "utf8");
      fs.renameSync(tmp, this.archivePath);
    });
    return this.archiveChain;
  }

  snapshot(): StoreData {
    return structuredClone(this.data);
  }

  archiveSnapshot(): ArchiveData {
    return structuredClone(this.archive);
  }

  getOrCreateSession(sessionId?: string, label = "default"): Session {
    if (sessionId) {
      const existing = this.data.sessions.find((s) => s.id === sessionId);
      if (existing) {
        existing.lastActivityAt = new Date().toISOString();
        return existing;
      }
    }
    const session: Session = {
      id: sessionId || randomUUID(),
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      label,
    };
    this.data.sessions.push(session);
    return session;
  }

  listSessions(): Session[] {
    return [...this.data.sessions].sort((a, b) =>
      b.lastActivityAt.localeCompare(a.lastActivityAt),
    );
  }

  getMessage(id: string): InboxMessage | undefined {
    return this.data.messages.find((m) => m.id === id);
  }

  getBatch(id: string): Batch | undefined {
    return this.data.batches.find((b) => b.id === id);
  }

  listMessages(sessionId?: string): InboxMessage[] {
    const rows = sessionId
      ? this.data.messages.filter((m) => m.sessionId === sessionId)
      : this.data.messages;
    return [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  openBatches(sessionId: string): Batch[] {
    return this.data.batches.filter(
      (b) =>
        b.sessionId === sessionId &&
        (b.state === "collecting" || b.state === "awaiting_more"),
    );
  }

  batchesByState(...states: BatchState[]): Batch[] {
    return this.data.batches.filter((b) => states.includes(b.state));
  }

  listArchivedBatches(limit = 20): ArchivedBatch[] {
    return [...this.archive.batches]
      .sort((a, b) => (b.ackedAt ?? "").localeCompare(a.ackedAt ?? ""))
      .slice(0, limit)
      .map((b) => ({
        ...b,
        composedAt: b.composedAt ?? b.readyAt ?? null,
        dispatchedAt: b.dispatchedAt ?? null,
        ackReason: b.ackReason ?? null,
        cursorAgentId: b.cursorAgentId ?? null,
        cursorRunId: b.cursorRunId ?? null,
        deployStatus: b.deployStatus ?? "none",
        deployNote: b.deployNote ?? null,
        deployedAt: b.deployedAt ?? null,
      }));
  }

  async addMessage(msg: InboxMessage): Promise<InboxMessage> {
    this.data.messages.push(msg);
    const session = this.data.sessions.find((s) => s.id === msg.sessionId);
    if (session) session.lastActivityAt = msg.createdAt;
    await this.persist();
    return msg;
  }

  async updateMessage(
    id: string,
    patch: Partial<InboxMessage>,
  ): Promise<InboxMessage | null> {
    const msg = this.getMessage(id);
    if (!msg) return null;
    Object.assign(msg, patch);
    await this.persist();
    return msg;
  }

  async addBatch(batch: Batch): Promise<Batch> {
    this.data.batches.push(batch);
    await this.persist();
    return batch;
  }

  async updateBatch(id: string, patch: Partial<Batch>): Promise<Batch | null> {
    const batch = this.getBatch(id);
    if (!batch) return null;
    Object.assign(batch, patch);
    await this.persist();
    return batch;
  }

  /**
   * Ack a batch: move it and its messages to archive.json and remove from active store.
   * Poll never calls this — only explicit ack endpoints / SDK success path.
   */
  async archiveBatch(
    id: string,
    reason: AckReason,
  ): Promise<{ batch: ArchivedBatch; messages: ArchivedMessage[] } | null> {
    const batch = this.getBatch(id);
    if (!batch) return null;

    const ackedAt = new Date().toISOString();
    const archivedBatch: ArchivedBatch = {
      ...batch,
      state: "acked",
      ackedAt,
      ackReason: reason,
    };
    const archivedMessages: ArchivedMessage[] = [];

    for (const mid of batch.messageIds) {
      const msg = this.getMessage(mid);
      if (!msg) continue;
      archivedMessages.push({
        ...msg,
        status: "acked",
        ackedAt,
        ackReason: reason,
      });
    }

    this.archive.batches.push(archivedBatch);
    this.archive.messages.push(...archivedMessages);

    const removeMsgIds = new Set(batch.messageIds);
    this.data.batches = this.data.batches.filter((b) => b.id !== id);
    this.data.messages = this.data.messages.filter((m) => !removeMsgIds.has(m.id));

    await Promise.all([this.persist(), this.persistArchive()]);
    return { batch: archivedBatch, messages: archivedMessages };
  }

  /** Ack a standalone message (not tied to a batch ack). */
  async archiveMessage(
    id: string,
    reason: AckReason,
  ): Promise<ArchivedMessage | null> {
    const msg = this.getMessage(id);
    if (!msg) return null;

    const ackedAt = new Date().toISOString();
    const archived: ArchivedMessage = {
      ...msg,
      status: "acked",
      ackedAt,
      ackReason: reason,
    };
    this.archive.messages.push(archived);
    this.data.messages = this.data.messages.filter((m) => m.id !== id);
    await Promise.all([this.persist(), this.persistArchive()]);
    return archived;
  }

  async save(): Promise<void> {
    await this.persist();
  }

  lastActivityAt(): string | null {
    let latest: string | null = null;
    for (const s of this.data.sessions) {
      if (!latest || s.lastActivityAt > latest) latest = s.lastActivityAt;
    }
    return latest;
  }
}

export const store = new JsonStore();
