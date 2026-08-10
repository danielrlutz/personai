import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function scriptPath(): string {
  return path.resolve(__dirname, "../../scripts/images_to_pdf.py");
}

function run(
  cmd: string,
  args: string[],
  opts?: { timeoutMs?: number },
): Promise<{ code: number; stdout: string; stderr: string }> {
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

/**
 * Assemble page images into a multipage PDF via PyMuPDF.
 * Returns null when Python/fitz is unavailable (caller should fall back).
 */
export async function imagesToPdf(
  imagePaths: string[],
  outPdfPath: string,
): Promise<string | null> {
  if (imagePaths.length === 0) return null;
  const py = await whichPython();
  if (!py) return null;
  const script = scriptPath();
  try {
    await fs.access(script);
  } catch {
    return null;
  }
  const res = await run(py, [script, outPdfPath, ...imagePaths], { timeoutMs: 180_000 });
  if (res.code !== 0) {
    throw new Error(`images_to_pdf.py failed: ${res.stderr || res.stdout}`);
  }
  await fs.access(outPdfPath);
  return outPdfPath;
}
