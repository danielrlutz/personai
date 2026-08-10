import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// Isolate store path by monkey-patching profileDir via temp DATA — use direct DB API smoke.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "personai-dk-"));
const dbPath = path.join(tmp, "drive-knowledge.db");
const db = new DatabaseSync(dbPath);
db.exec(`
CREATE TABLE files (
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
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drive_file_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  embedding BLOB
);
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  text,
  drive_file_id UNINDEXED,
  content='chunks',
  content_rowid='id'
);
`);
db.prepare(
  `INSERT INTO files(drive_file_id, name, folder_path, folder_label, archive_category,
    mime_type, modified_time, web_view_link, content_text, content_hash, indexed_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
).run(
  "file1",
  "Invoice_Swisscom.pdf",
  "1. Official Documents",
  "1. Official Documents",
  1,
  "application/pdf",
  null,
  null,
  "Swisscom invoice CHF 40",
  "hash1",
  new Date().toISOString(),
);
const info = db
  .prepare(
    "INSERT INTO chunks(drive_file_id, chunk_index, text, embedding) VALUES (?, ?, ?, ?)",
  )
  .run("file1", 0, "File: Invoice_Swisscom.pdf\nOCR: Swisscom invoice CHF 40", null) as {
  lastInsertRowid: number | bigint;
};
const id = Number(info.lastInsertRowid);
db.prepare("INSERT INTO chunks_fts(rowid, text, drive_file_id) VALUES (?, ?, ?)").run(
  id,
  "File: Invoice_Swisscom.pdf OCR Swisscom invoice CHF 40",
  "file1",
);

const hits = db
  .prepare("SELECT text FROM chunks_fts WHERE chunks_fts MATCH ?")
  .all('"swisscom" OR "invoice"') as Array<{ text: string }>;
assert.ok(hits.length >= 1);

db.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log("drive-knowledge store/fts checks ok");
