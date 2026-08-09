import type { OutboxOp } from "./types";

const DB_NAME = "personai-outbox";
const DB_VERSION = 1;
const OPS_STORE = "ops";
const BLOBS_STORE = "blobs";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(OPS_STORE)) {
        const ops = db.createObjectStore(OPS_STORE, { keyPath: "id" });
        ops.createIndex("by_status", "status", { unique: false });
        ops.createIndex("by_profile", "profileId", { unique: false });
        ops.createIndex("by_updated", "updatedAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(BLOBS_STORE)) {
        db.createObjectStore(BLOBS_STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open outbox DB"));
  });
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export async function idbPutOp(op: OutboxOp): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(OPS_STORE, "readwrite");
  tx.objectStore(OPS_STORE).put(op);
  await txDone(tx);
}

export async function idbGetOp(id: string): Promise<OutboxOp | undefined> {
  const db = await openDb();
  return reqToPromise(db.transaction(OPS_STORE).objectStore(OPS_STORE).get(id));
}

export async function idbDeleteOp(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(OPS_STORE, "readwrite");
  tx.objectStore(OPS_STORE).delete(id);
  await txDone(tx);
}

export async function idbListOps(): Promise<OutboxOp[]> {
  const db = await openDb();
  const all = await reqToPromise(db.transaction(OPS_STORE).objectStore(OPS_STORE).getAll());
  return (all as OutboxOp[]).sort((a, b) => a.createdAt - b.createdAt);
}

export async function idbPutBlob(key: string, blob: Blob, meta?: { filename?: string; mimeType?: string }): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(BLOBS_STORE, "readwrite");
  tx.objectStore(BLOBS_STORE).put({
    key,
    blob,
    filename: meta?.filename,
    mimeType: meta?.mimeType,
    storedAt: Date.now(),
  });
  await txDone(tx);
}

export async function idbGetBlob(key: string): Promise<Blob | undefined> {
  const db = await openDb();
  const row = await reqToPromise<{ key: string; blob: Blob } | undefined>(
    db.transaction(BLOBS_STORE).objectStore(BLOBS_STORE).get(key),
  );
  return row?.blob;
}

export async function idbDeleteBlob(key: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(BLOBS_STORE, "readwrite");
  tx.objectStore(BLOBS_STORE).delete(key);
  await txDone(tx);
}
