import fs from "node:fs/promises";
import jsQR from "jsqr";
import { PNG } from "pngjs";

/** Swiss Payment Code (SPC) fields from a QR-bill payload. */
export type SwissQrBill = {
  payload: string;
  iban: string;
  creditorName: string;
  creditorAddress: string | null;
  amount: number | null;
  currency: string;
  reference: string | null;
  referenceType: string | null;
  additionalInfo: string | null;
};

type JsQrFn = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: { inversionAttempts?: string },
) => { data: string } | null;

function getJsQr(): JsQrFn {
  const mod = jsQR as unknown as JsQrFn | { default: JsQrFn };
  return typeof mod === "function" ? mod : mod.default;
}

/** Parse Swiss QR-bill SPC payload (CRLF or LF). Tolerates missing trailing empties. */
export function parseSwissQrPayload(raw: string): SwissQrBill | null {
  const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = text.split("\n");
  if ((lines[0] ?? "").trim() !== "SPC") return null;

  const iban = (lines[3] ?? "").replace(/\s+/g, "").toUpperCase();
  if (!iban.startsWith("CH") && !iban.startsWith("LI")) return null;

  const addrType = (lines[4] ?? "").trim();
  const name = (lines[5] ?? "").trim();
  let address: string | null = null;
  if (addrType === "S") {
    const street = [lines[6], lines[7]].filter(Boolean).join(" ").trim();
    const city = [lines[8], lines[9], lines[10]].filter(Boolean).join(" ").trim();
    address = [street, city].filter(Boolean).join(", ") || null;
  } else if (addrType === "K") {
    address = [lines[6], lines[7]].filter(Boolean).join(", ") || null;
  }

  // Spec indices when fully padded: amount=18, currency=19
  let amount: number | null = null;
  let currency = "CHF";
  if (lines.length > 19) {
    const amountRaw = (lines[18] ?? "").trim().replace(/'/g, "").replace(",", ".");
    if (amountRaw) {
      const n = Number(amountRaw);
      if (Number.isFinite(n)) amount = n;
    }
    const cur = (lines[19] ?? "").trim().toUpperCase();
    if (cur === "CHF" || cur === "EUR") currency = cur;
  } else {
    // Short / messy payloads: find CHF/EUR then treat prior numeric as amount
    for (let i = 0; i < lines.length; i++) {
      const t = (lines[i] ?? "").trim().toUpperCase();
      if (t === "CHF" || t === "EUR") {
        currency = t;
        const prev = (lines[i - 1] ?? "").trim().replace(/'/g, "").replace(",", ".");
        if (prev && Number.isFinite(Number(prev))) amount = Number(prev);
        break;
      }
    }
  }

  let referenceType: string | null = null;
  let reference: string | null = null;
  let additionalInfo: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const t = (lines[i] ?? "").trim();
    if (t === "QRR" || t === "SCOR" || t === "NON") {
      referenceType = t;
      reference = (lines[i + 1] ?? "").trim() || null;
      const maybeAdd = (lines[i + 2] ?? "").trim();
      if (maybeAdd && maybeAdd !== "EPD") additionalInfo = maybeAdd;
      break;
    }
  }

  if (!name && !iban) return null;

  return {
    payload: text.trim(),
    iban,
    creditorName: name || "Unknown",
    creditorAddress: address,
    amount,
    currency,
    reference,
    referenceType,
    additionalInfo,
  };
}

export async function decodeQrFromPngFile(filePath: string): Promise<string | null> {
  const buf = await fs.readFile(filePath);
  return decodeQrFromPngBuffer(buf);
}

export function decodeQrFromPngBuffer(buf: Buffer): string | null {
  try {
    const png = PNG.sync.read(buf);
    const code = getJsQr()(new Uint8ClampedArray(png.data), png.width, png.height, {
      inversionAttempts: "attemptBoth",
    });
    return code?.data?.trim() ? code.data : null;
  } catch {
    return null;
  }
}

/** Try full page, then common Swiss Zahlteil QR region (lower-right ~40%). */
export async function findSwissQrInPng(filePath: string): Promise<SwissQrBill | null> {
  const buf = await fs.readFile(filePath);
  const attempts: Buffer[] = [buf];

  try {
    const png = PNG.sync.read(buf);
    const crop = cropPng(png, 0.45, 0.45, 1, 1);
    if (crop) attempts.push(crop);
    const cropLeft = cropPng(png, 0, 0.55, 0.55, 1);
    if (cropLeft) attempts.push(cropLeft);
  } catch {
    // ignore crop failures
  }

  for (const attempt of attempts) {
    const raw = decodeQrFromPngBuffer(attempt);
    if (!raw) continue;
    const parsed = parseSwissQrPayload(raw);
    if (parsed) return parsed;
  }
  return null;
}

function cropPng(
  png: PNG,
  x0r: number,
  y0r: number,
  x1r: number,
  y1r: number,
): Buffer | null {
  const x0 = Math.floor(png.width * x0r);
  const y0 = Math.floor(png.height * y0r);
  const x1 = Math.floor(png.width * x1r);
  const y1 = Math.floor(png.height * y1r);
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 32 || h < 32) return null;

  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = ((y0 + y) * png.width + (x0 + x)) << 2;
      const dst = (y * w + x) << 2;
      out.data[dst] = png.data[src]!;
      out.data[dst + 1] = png.data[src + 1]!;
      out.data[dst + 2] = png.data[src + 2]!;
      out.data[dst + 3] = png.data[src + 3]!;
    }
  }
  return PNG.sync.write(out);
}

export function isLikelySwissIban(value: string | null | undefined): boolean {
  if (!value) return false;
  const iban = value.replace(/\s+/g, "").toUpperCase();
  return /^(CH|LI)[0-9A-Z]{5,}$/.test(iban);
}
