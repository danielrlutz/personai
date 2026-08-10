/**
 * Local Drive knowledge index (sidecar SQLite under profile data dir).
 * Hybrid: FTS5 keyword + float32 embedding blobs. Private — never sent to Gemini.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { profileDir } from "../../config.js";
import type { NamingToken } from "./terminology.js";

export type KnowledgeFileRow = {
  driveFileId: string;
  name: string;
  folderPath: string;
  folderLabel: string;
  archiveCategory: number | null;
  mimeType: string | null;
  modifiedTime: string | null;
  webViewLink: string | null;
  contentText: string | null;
  contentHash: string;
  indexedAt: string;
};

export type KnowledgeChunkRow = {
  id: number;
  driveFileId: string;
  chunkIndex: number;
  text: string;
  embedding: Float32Array | null;
};

export type KnowledgeStats = {
  fileCount: number;
  chunkCount: number;
  withEmbedding: number;
  embedModel: string | null;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
};

const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS files (
  drive_file_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  folder_path TEXT NOT NULL DEFAULT '',
  folder_label TEXT NOT NULL DEFAULT '',
  archive_category INTEGER,
  mime_type TEXT,
  modified_time TEXT,
  web_view_link TEXT,
  content_text TEXT,
  content_hash TEXT NOT NULL,
  indexed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drive_file_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  embedding BLOB,
  FOREIGN KEY (drive_file_id) REFERENCES files(drive_file_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(drive_file_id);
CREATE TABLE IF NOT EXISTS terminology (
  token TEXT NOT NULL,
  kind TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  examples TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (kind, token)
);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text,
  drive_file_id UNINDEXED,
  content='chunks',
  content_rowid='id'
);
`;

let cached: { profileId: string; db: DatabaseSync } | null = null;

export function driveKnowledgeDbPath(profileId: string): string {
  return path.join(profileDir(profileId), "drive-knowledge.db");
}

export function openKnowledgeStore(profileId: string): DatabaseSync {
  if (cached?.profileId === profileId) return cached.db;
  if (cached) {
    try {
      cached.db.close();
    } catch {
      /* ignore */
    }
    cached = null;
  }
  fs.mkdirSync(profileDir(profileId), { recursive: true });
  const db = new DatabaseSync(driveKnowledgeDbPath(profileId));
  db.exec(SCHEMA);
  cached = { profileId, db };
  return db;
}

export function closeKnowledgeStore(): void {
  if (!cached) return;
  try {
    cached.db.close();
  } catch {
    /* ignore */
  }
  cached = null;
}

function getMeta(db: DatabaseSync, key: string): string | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function setMeta(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    "INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

export function getKnowledgeStats(profileId: string): KnowledgeStats {
  const db = openKnowledgeStore(profileId);
  const fileCount = (
    db.prepare("SELECT COUNT(*) AS c FROM files").get() as { c: number }
  ).c;
  const chunkCount = (
    db.prepare("SELECT COUNT(*) AS c FROM chunks").get() as { c: number }
  ).c;
  const withEmbedding = (
    db
      .prepare("SELECT COUNT(*) AS c FROM chunks WHERE embedding IS NOT NULL")
      .get() as { c: number }
  ).c;
  return {
    fileCount,
    chunkCount,
    withEmbedding,
    embedModel: getMeta(db, "embedModel"),
    lastSyncAt: getMeta(db, "lastSyncAt"),
    lastSyncStatus: getMeta(db, "lastSyncStatus"),
  };
}

export function setSyncMeta(
  profileId: string,
  patch: { status?: string; embedModel?: string | null; at?: string },
): void {
  const db = openKnowledgeStore(profileId);
  if (patch.status != null) setMeta(db, "lastSyncStatus", patch.status);
  if (patch.embedModel !== undefined) {
    setMeta(db, "embedModel", patch.embedModel ?? "");
  }
  if (patch.at) setMeta(db, "lastSyncAt", patch.at);
}

function blobToFloat32(blob: unknown): Float32Array | null {
  if (blob == null) return null;
  if (blob instanceof Float32Array) return blob;
  if (blob instanceof ArrayBuffer) return new Float32Array(blob);
  if (ArrayBuffer.isView(blob)) {
    const view = blob as ArrayBufferView;
    return new Float32Array(view.buffer, view.byteOffset, view.byteLength / 4);
  }
  if (Buffer.isBuffer(blob)) {
    return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
  }
  return null;
}

export function upsertKnowledgeFile(
  profileId: string,
  file: Omit<KnowledgeFileRow, "indexedAt"> & { indexedAt?: string },
  chunks: Array<{ text: string; embedding: Float32Array | null }>,
): void {
  const db = openKnowledgeStore(profileId);
  const indexedAt = file.indexedAt ?? new Date().toISOString();
  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO files(
        drive_file_id, name, folder_path, folder_label, archive_category,
        mime_type, modified_time, web_view_link, content_text, content_hash, indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(drive_file_id) DO UPDATE SET
        name=excluded.name,
        folder_path=excluded.folder_path,
        folder_label=excluded.folder_label,
        archive_category=excluded.archive_category,
        mime_type=excluded.mime_type,
        modified_time=excluded.modified_time,
        web_view_link=excluded.web_view_link,
        content_text=excluded.content_text,
        content_hash=excluded.content_hash,
        indexed_at=excluded.indexed_at`,
    ).run(
      file.driveFileId,
      file.name,
      file.folderPath,
      file.folderLabel,
      file.archiveCategory,
      file.mimeType,
      file.modifiedTime,
      file.webViewLink,
      file.contentText,
      file.contentHash,
      indexedAt,
    );

    const oldIds = db
      .prepare("SELECT id FROM chunks WHERE drive_file_id = ?")
      .all(file.driveFileId) as Array<{ id: number }>;
    for (const row of oldIds) {
      db.prepare("DELETE FROM chunks_fts WHERE rowid = ?").run(row.id);
    }
    db.prepare("DELETE FROM chunks WHERE drive_file_id = ?").run(file.driveFileId);

    const insertChunk = db.prepare(
      "INSERT INTO chunks(drive_file_id, chunk_index, text, embedding) VALUES (?, ?, ?, ?)",
    );
    const insertFts = db.prepare(
      "INSERT INTO chunks_fts(rowid, text, drive_file_id) VALUES (?, ?, ?)",
    );
    chunks.forEach((c, i) => {
      const emb =
        c.embedding && c.embedding.length > 0
          ? Buffer.from(c.embedding.buffer, c.embedding.byteOffset, c.embedding.byteLength)
          : null;
      const info = insertChunk.run(file.driveFileId, i, c.text, emb) as {
        lastInsertRowid: number | bigint;
      };
      const id = Number(info.lastInsertRowid);
      insertFts.run(id, c.text, file.driveFileId);
    });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function getFileHash(profileId: string, driveFileId: string): string | null {
  const db = openKnowledgeStore(profileId);
  const row = db
    .prepare("SELECT content_hash FROM files WHERE drive_file_id = ?")
    .get(driveFileId) as { content_hash: string } | undefined;
  return row?.content_hash ?? null;
}

export function listIndexedFileIds(profileId: string): Set<string> {
  const db = openKnowledgeStore(profileId);
  const rows = db.prepare("SELECT drive_file_id FROM files").all() as Array<{
    drive_file_id: string;
  }>;
  return new Set(rows.map((r) => r.drive_file_id));
}

export function deleteMissingFiles(profileId: string, keepIds: Set<string>): number {
  const db = openKnowledgeStore(profileId);
  const existing = listIndexedFileIds(profileId);
  let removed = 0;
  for (const id of existing) {
    if (keepIds.has(id)) continue;
    const oldIds = db
      .prepare("SELECT id FROM chunks WHERE drive_file_id = ?")
      .all(id) as Array<{ id: number }>;
    for (const row of oldIds) {
      db.prepare("DELETE FROM chunks_fts WHERE rowid = ?").run(row.id);
    }
    db.prepare("DELETE FROM chunks WHERE drive_file_id = ?").run(id);
    db.prepare("DELETE FROM files WHERE drive_file_id = ?").run(id);
    removed += 1;
  }
  return removed;
}

export function replaceTerminology(profileId: string, tokens: NamingToken[]): void {
  const db = openKnowledgeStore(profileId);
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM terminology").run();
    const ins = db.prepare(
      "INSERT INTO terminology(token, kind, count, examples) VALUES (?, ?, ?, ?)",
    );
    for (const t of tokens) {
      ins.run(t.token, t.kind, t.count, JSON.stringify(t.examples.slice(0, 3)));
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function readTerminology(profileId: string): NamingToken[] {
  const db = openKnowledgeStore(profileId);
  const rows = db
    .prepare("SELECT token, kind, count, examples FROM terminology ORDER BY count DESC")
    .all() as Array<{ token: string; kind: string; count: number; examples: string }>;
  return rows.map((r) => ({
    token: r.token,
    kind: r.kind as NamingToken["kind"],
    count: r.count,
    examples: (() => {
      try {
        return JSON.parse(r.examples) as string[];
      } catch {
        return [];
      }
    })(),
  }));
}

export function listFolderLabels(
  profileId: string,
): Array<{ archiveCategory: number | null; label: string }> {
  const db = openKnowledgeStore(profileId);
  const rows = db
    .prepare(
      `SELECT DISTINCT archive_category AS archiveCategory, folder_label AS label
       FROM files WHERE folder_label != ''`,
    )
    .all() as Array<{ archiveCategory: number | null; label: string }>;
  return rows;
}

export function keywordSearch(
  profileId: string,
  query: string,
  limit = 20,
): Array<{ chunkId: number; driveFileId: string; text: string; score: number }> {
  const db = openKnowledgeStore(profileId);
  const q = sanitizeFtsQuery(query);
  if (!q) return [];
  try {
    const rows = db
      .prepare(
        `SELECT c.id AS chunkId, c.drive_file_id AS driveFileId, c.text AS text,
                bm25(chunks_fts) AS rank
         FROM chunks_fts
         JOIN chunks c ON c.id = chunks_fts.rowid
         WHERE chunks_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(q, limit) as Array<{
      chunkId: number;
      driveFileId: string;
      text: string;
      rank: number;
    }>;
    // bm25: lower is better → invert for hybrid
    return rows.map((r) => ({
      chunkId: r.chunkId,
      driveFileId: r.driveFileId,
      text: r.text,
      score: 1 / (1 + Math.max(0, r.rank)),
    }));
  } catch {
    return [];
  }
}

export function loadChunksWithEmbeddings(
  profileId: string,
): Array<{ chunkId: number; driveFileId: string; text: string; embedding: Float32Array }> {
  const db = openKnowledgeStore(profileId);
  const rows = db
    .prepare(
      `SELECT id AS chunkId, drive_file_id AS driveFileId, text, embedding
       FROM chunks WHERE embedding IS NOT NULL`,
    )
    .all() as Array<{
    chunkId: number;
    driveFileId: string;
    text: string;
    embedding: unknown;
  }>;
  const out: Array<{
    chunkId: number;
    driveFileId: string;
    text: string;
    embedding: Float32Array;
  }> = [];
  for (const r of rows) {
    const emb = blobToFloat32(r.embedding);
    if (emb && emb.length > 0) {
      out.push({
        chunkId: r.chunkId,
        driveFileId: r.driveFileId,
        text: r.text,
        embedding: emb,
      });
    }
  }
  return out;
}

export function getFilesByIds(
  profileId: string,
  ids: string[],
): Map<string, KnowledgeFileRow> {
  const db = openKnowledgeStore(profileId);
  const map = new Map<string, KnowledgeFileRow>();
  const stmt = db.prepare(
    `SELECT drive_file_id AS driveFileId, name, folder_path AS folderPath,
            folder_label AS folderLabel, archive_category AS archiveCategory,
            mime_type AS mimeType, modified_time AS modifiedTime,
            web_view_link AS webViewLink, content_text AS contentText,
            content_hash AS contentHash, indexed_at AS indexedAt
     FROM files WHERE drive_file_id = ?`,
  );
  for (const id of ids) {
    const row = stmt.get(id) as KnowledgeFileRow | undefined;
    if (row) map.set(id, row);
  }
  return map;
}

/** FTS5 query: keep alphanumerics, OR-join tokens. */
export function sanitizeFtsQuery(raw: string): string {
  const tokens = String(raw ?? "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .slice(0, 12);
  if (tokens.length === 0) return "";
  return tokens.map((t) => `"${t.replace(/"/g, "")}"`).join(" OR ");
}
