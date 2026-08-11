import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import type {
  Batch,
  BatchState,
  InboxMessage,
  Session,
  StoreData,
} from "./types.js";

function emptyStore(): StoreData {
  return { version: 1, sessions: [], messages: [], batches: [] };
}

export class JsonStore {
  private data: StoreData = emptyStore();
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly filePath = config.storePath) {}

  async init(): Promise<void> {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.mkdirSync(config.uploadsDir, { recursive: true });
    fs.mkdirSync(config.thumbsDir, { recursive: true });
    if (fs.existsSync(this.filePath)) {
      const raw = fs.readFileSync(this.filePath, "utf8");
      this.data = JSON.parse(raw) as StoreData;
    } else {
      this.data = emptyStore();
      await this.persist();
    }
  }

  private persist(): Promise<void> {
    this.writeChain = this.writeChain.then(() => {
      const tmp = `${this.filePath}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), "utf8");
      fs.renameSync(tmp, this.filePath);
    });
    return this.writeChain;
  }

  snapshot(): StoreData {
    return structuredClone(this.data);
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
