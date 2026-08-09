import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PreparedPage } from "./bulk-split.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type PrepareManifest = {
  source: string;
  pageCount: number;
  renderedCount: number;
  truncated: boolean;
  dpi: number;
  creator: string;
  pages: Array<{
    index: number;
    pageNumber: number;
    file: string;
    width: number;
    height: number;
    meanBrightness: number;
    nearWhiteRatio: number;
    blank: boolean;
  }>;
};

export type PreparedDocument = {
  kind: "pdf" | "image" | "raw";
  workDir: string;
  pages: PreparedPage[];
  manifest: PrepareManifest | null;
  creator: string;
};

const MAX_PAGES = Number(process.env.INGEST_MAX_PAGES ?? 40);
const DPI = Number(process.env.INGEST_PDF_DPI ?? 140);

function scriptPath(): string {
  // dist/ingest → ../../scripts ; also allow cwd-relative for deploy layouts
  return path.resolve(__dirname, "../../scripts/pdf_prepare.py");
}

function run(cmd: string, args: string[], opts?: { timeoutMs?: number }): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} timed out`));
    }, opts?.timeoutMs ?? 120_000);
    child.stdout.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function whichPython(): Promise<string | null> {
  for (const cmd of process.platform === "win32" ? ["python", "py"] : ["python3", "python"]) {
    try {
      const res = await run(cmd, ["-c", "import fitz; print('ok')"], { timeoutMs: 15_000 });
      if (res.code === 0 && res.stdout.includes("ok")) return cmd;
    } catch {
      // try next
    }
  }
  return null;
}

async function prepareWithPython(pdfPath: string, workDir: string): Promise<PrepareManifest> {
  const py = await whichPython();
  if (!py) throw new Error("python+pymupdf unavailable");
  const script = scriptPath();
  await fs.access(script);
  const res = await run(
    py,
    [script, pdfPath, workDir, "--dpi", String(DPI), "--max-pages", String(MAX_PAGES)],
    { timeoutMs: 180_000 },
  );
  if (res.code !== 0) {
    throw new Error(`pdf_prepare.py failed: ${res.stderr || res.stdout}`);
  }
  const raw = await fs.readFile(path.join(workDir, "manifest.json"), "utf-8");
  return JSON.parse(raw) as PrepareManifest;
}

async function prepareWithPdftoppm(pdfPath: string, workDir: string): Promise<PrepareManifest> {
  const prefix = path.join(workDir, "page");
  const res = await run(
    "pdftoppm",
    ["-png", "-r", String(DPI), "-l", String(MAX_PAGES), pdfPath, prefix],
    { timeoutMs: 180_000 },
  );
  if (res.code !== 0) {
    throw new Error(`pdftoppm failed: ${res.stderr || res.stdout}`);
  }
  const files = (await fs.readdir(workDir))
    .filter((f) => /^page-?\d+\.png$/i.test(f) || /^page\d+\.png$/i.test(f))
    .sort();
  // pdftoppm names: page-1.png or page1.png
  const normalized: PrepareManifest["pages"] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const dest = `page-${String(i + 1).padStart(3, "0")}.png`;
    if (file !== dest) {
      await fs.rename(path.join(workDir, file), path.join(workDir, dest));
    }
    normalized.push({
      index: i,
      pageNumber: i + 1,
      file: dest,
      width: 0,
      height: 0,
      meanBrightness: 128,
      nearWhiteRatio: 0.5,
      blank: false,
    });
  }
  return {
    source: pdfPath,
    pageCount: normalized.length,
    renderedCount: normalized.length,
    truncated: false,
    dpi: DPI,
    creator: "",
    pages: normalized,
  };
}

function isPdf(filePath: string, mimeType?: string | null): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".pdf") return true;
  return Boolean(mimeType && mimeType.toLowerCase().includes("pdf"));
}

function isRasterImage(filePath: string, mimeType?: string | null): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) return true;
  return Boolean(mimeType && mimeType.toLowerCase().startsWith("image/"));
}

async function copyAsSinglePng(src: string, workDir: string): Promise<PreparedDocument> {
  await fs.mkdir(workDir, { recursive: true });
  const ext = path.extname(src).toLowerCase();
  const destName = ext === ".png" ? "page-001.png" : "page-001.png";
  const dest = path.join(workDir, destName);
  // For JPEG uploads, still copy bytes — vision accepts jpeg base64; QR decode needs PNG.
  // If not PNG, we send to vision as-is and skip jsQR (swiss-qr PNG-only).
  if (ext === ".png") {
    await fs.copyFile(src, dest);
  } else {
    // Keep original bytes with .png name only if already png; else store as page-001.bin and mark image
    await fs.copyFile(src, path.join(workDir, `page-001${ext || ".img"}`));
    await fs.copyFile(src, dest).catch(() => undefined);
    // If copy to png path from jpeg, vision still works reading that file as base64
    if (ext !== ".png") {
      await fs.copyFile(src, dest);
    }
  }
  const page: PreparedPage = {
    index: 0,
    pageNumber: 1,
    file: path.basename(dest),
    path: dest,
    blank: false,
  };
  return {
    kind: "image",
    workDir,
    pages: [page],
    manifest: null,
    creator: "",
  };
}

/**
 * Prepare a document for vision OCR: rasterize PDF pages into workDir.
 * Falls back to single raw file when rasterization tools are missing.
 */
export async function prepareDocumentForOcr(opts: {
  storagePath: string;
  workDir: string;
  mimeType?: string | null;
}): Promise<PreparedDocument> {
  const { storagePath, workDir, mimeType } = opts;
  await fs.mkdir(workDir, { recursive: true });

  if (isRasterImage(storagePath, mimeType) && !isPdf(storagePath, mimeType)) {
    return copyAsSinglePng(storagePath, workDir);
  }

  if (!isPdf(storagePath, mimeType)) {
    const dest = path.join(workDir, "page-001.bin");
    await fs.copyFile(storagePath, dest);
    return {
      kind: "raw",
      workDir,
      pages: [
        {
          index: 0,
          pageNumber: 1,
          file: "page-001.bin",
          path: dest,
          blank: false,
        },
      ],
      manifest: null,
      creator: "",
    };
  }

  let manifest: PrepareManifest | null = null;
  let lastErr: unknown;
  try {
    manifest = await prepareWithPython(storagePath, workDir);
  } catch (err) {
    lastErr = err;
    try {
      manifest = await prepareWithPdftoppm(storagePath, workDir);
    } catch (err2) {
      lastErr = err2;
    }
  }

  if (!manifest || manifest.pages.length === 0) {
    // Last resort: feed raw PDF bytes (legacy behaviour) — caller should warn in extraction
    const dest = path.join(workDir, "original.pdf");
    await fs.copyFile(storagePath, dest);
    return {
      kind: "raw",
      workDir,
      pages: [
        {
          index: 0,
          pageNumber: 1,
          file: "original.pdf",
          path: dest,
          blank: false,
        },
      ],
      manifest: null,
      creator: "",
    };
  }

  const pages: PreparedPage[] = manifest.pages.map((p) => ({
    index: p.index,
    pageNumber: p.pageNumber,
    file: p.file,
    path: path.join(workDir, p.file),
    blank: p.blank,
    nearWhiteRatio: p.nearWhiteRatio,
    meanBrightness: p.meanBrightness,
  }));

  return {
    kind: "pdf",
    workDir,
    pages,
    manifest,
    creator: manifest.creator,
  };
}

export function prepareWarning(doc: PreparedDocument): string | null {
  if (doc.kind === "raw") {
    return "PDF rasterization unavailable (install PyMuPDF or poppler-utils); used raw file fallback";
  }
  if (doc.manifest?.truncated) {
    return `PDF truncated to first ${doc.manifest.renderedCount} pages (of ${doc.manifest.pageCount})`;
  }
  return null;
}
