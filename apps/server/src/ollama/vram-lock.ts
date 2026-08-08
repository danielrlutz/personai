import { EventEmitter } from "node:events";
import {
  listRunningModels,
  modelForSlot,
  resolveOllamaHost,
  unloadModel,
  type OllamaSlot,
} from "./client.js";

export type LockState = {
  holder: OllamaSlot | null;
  waiting: number;
  pausedReason: string | null;
};

class VramLock extends EventEmitter {
  private holder: OllamaSlot | null = null;
  private queue: Array<{
    slot: OllamaSlot;
    resolve: () => void;
    reject: (err: Error) => void;
  }> = [];
  private acquiring = false;

  getState(): LockState {
    return {
      holder: this.holder,
      waiting: this.queue.length,
      pausedReason: this.queue[0]
        ? `waiting_for_vram:${modelForSlot(this.holder ?? this.queue[0].slot)}`
        : null,
    };
  }

  async acquire(slot: OllamaSlot, onWait?: (reason: string) => void): Promise<() => Promise<void>> {
    if (this.holder === null && !this.acquiring && this.queue.length === 0) {
      await this.take(slot);
      return () => this.release(slot);
    }

    const reason = `waiting_for_vram:${modelForSlot(this.holder ?? "REASONING")}`;
    onWait?.(reason);

    await new Promise<void>((resolve, reject) => {
      this.queue.push({ slot, resolve, reject });
      this.emit("change", this.getState());
    });

    return () => this.release(slot);
  }

  private async take(slot: OllamaSlot): Promise<void> {
    this.acquiring = true;
    try {
      const host = await resolveOllamaHost();
      const competing = slot === "VISION" ? modelForSlot("REASONING") : modelForSlot("VISION");
      const running = await listRunningModels(host);
      const needsUnload = running.some((r) => r.includes(competing.split(":")[0]!));
      if (needsUnload) {
        await unloadModel(host, competing);
      }
      this.holder = slot;
      this.emit("change", this.getState());
    } finally {
      this.acquiring = false;
    }
  }

  private async release(slot: OllamaSlot): Promise<void> {
    if (this.holder !== slot) return;

    try {
      const host = await resolveOllamaHost();
      await unloadModel(host, modelForSlot(slot));
    } catch {
      // best effort unload
    }

    this.holder = null;
    this.emit("change", this.getState());
    await this.pump();
  }

  private async pump(): Promise<void> {
    if (this.holder !== null || this.acquiring || this.queue.length === 0) return;
    const next = this.queue.shift()!;
    try {
      await this.take(next.slot);
      next.resolve();
    } catch (err) {
      next.reject(err instanceof Error ? err : new Error(String(err)));
      await this.pump();
    }
  }
}

export const vramLock = new VramLock();
