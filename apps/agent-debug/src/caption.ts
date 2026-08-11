import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { fileToBase64, modelAvailable, ollamaChat } from "./ollama.js";
import type { ImageMeta } from "./types.js";

export function stubCaption(meta: Pick<ImageMeta, "filename" | "size" | "mimeType">): string {
  const kb = Math.max(1, Math.round(meta.size / 1024));
  return `[image ${meta.filename} · ${meta.mimeType || "image"} · ${kb} KB]`;
}

export async function captionImage(meta: ImageMeta): Promise<string> {
  const stub = stubCaption(meta);
  const visionOk = await modelAvailable(config.visionModel);
  if (!visionOk || !fs.existsSync(meta.path)) {
    return stub;
  }
  try {
    const b64 = fileToBase64(meta.path);
    const text = await ollamaChat({
      model: config.visionModel,
      prompt:
        "Describe this image briefly for a coding agent (what it shows, any visible text/UI). Max 3 sentences.",
      imagesBase64: [b64],
      timeoutMs: 90_000,
    });
    if (!text) return stub;
    return `${stub}\nCaption: ${text}`;
  } catch {
    return stub;
  }
}

/** Tiny CSS-friendly “thumbnail”: copy original path reference (UI scales). */
export function ensureThumbPath(imagePath: string, imageId: string): string | null {
  try {
    if (!fs.existsSync(imagePath)) return null;
    const ext = path.extname(imagePath) || ".jpg";
    const dest = path.join(config.thumbsDir, `${imageId}${ext}`);
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(imagePath, dest);
    }
    return dest;
  } catch {
    return null;
  }
}
