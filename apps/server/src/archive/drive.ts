/**
 * Optional Google Drive upload (Harmonia-style folder IDs).
 * When credentials / folder IDs are missing, callers get a disabled status — never fake files.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { ARCHIVE_TAXONOMY } from "../specialists/roster.js";

export type DriveConfig = {
  enabled: boolean;
  mode: "service_account" | "oauth" | "none";
  rootFolderId: string | null;
  folderIds: Record<number, string>;
  serviceAccountPath: string | null;
  serviceAccountJson: string | null;
  oauthClientId: string | null;
  oauthClientSecret: string | null;
  oauthRefreshToken: string | null;
};

export type DriveUploadResult = {
  fileId: string;
  webViewLink: string | null;
  folderId: string;
  name: string;
};

type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

export function loadDriveConfig(): DriveConfig {
  const folderIds: Record<number, string> = {};
  const jsonMap = process.env.GOOGLE_DRIVE_FOLDERS?.trim();
  if (jsonMap) {
    try {
      const parsed = JSON.parse(jsonMap) as Record<string, string>;
      for (const [k, v] of Object.entries(parsed)) {
        const n = Number(k);
        if (Number.isFinite(n) && v) folderIds[n] = String(v).trim();
      }
    } catch {
      // ignore invalid JSON
    }
  }
  for (let i = 1; i <= 10; i++) {
    const v = process.env[`GOOGLE_DRIVE_FOLDER_${i}`]?.trim();
    if (v) folderIds[i] = v;
  }

  const serviceAccountPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() || null;
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_INLINE?.trim() || null;
  const oauthClientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() || null;
  const oauthClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() || null;
  const oauthRefreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN?.trim() || null;
  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID?.trim() || null;

  const hasSa = Boolean(serviceAccountPath || serviceAccountJson);
  const hasOauth = Boolean(oauthClientId && oauthClientSecret && oauthRefreshToken);
  const forceOff = ["0", "false", "no", "off"].includes(
    (process.env.GOOGLE_DRIVE_ENABLED ?? "").trim().toLowerCase(),
  );
  const forceOn = ["1", "true", "yes", "on"].includes(
    (process.env.GOOGLE_DRIVE_ENABLED ?? "").trim().toLowerCase(),
  );

  const mode: DriveConfig["mode"] = hasSa ? "service_account" : hasOauth ? "oauth" : "none";
  const enabled = !forceOff && (forceOn || mode !== "none") && mode !== "none";

  return {
    enabled,
    mode: enabled ? mode : "none",
    rootFolderId,
    folderIds,
    serviceAccountPath,
    serviceAccountJson,
    oauthClientId,
    oauthClientSecret,
    oauthRefreshToken,
  };
}

export function driveStatus(): {
  configured: boolean;
  enabled: boolean;
  mode: DriveConfig["mode"];
  rootFolderId: string | null;
  folderCount: number;
  taxonomy: typeof ARCHIVE_TAXONOMY;
} {
  const cfg = loadDriveConfig();
  return {
    configured: cfg.mode !== "none",
    enabled: cfg.enabled,
    mode: cfg.mode,
    rootFolderId: cfg.rootFolderId,
    folderCount: Object.keys(cfg.folderIds).length,
    taxonomy: ARCHIVE_TAXONOMY,
  };
}

function readServiceAccount(cfg: DriveConfig): ServiceAccount {
  let raw: string;
  if (cfg.serviceAccountJson) {
    raw = cfg.serviceAccountJson;
  } else if (cfg.serviceAccountPath) {
    const p = path.isAbsolute(cfg.serviceAccountPath)
      ? cfg.serviceAccountPath
      : path.resolve(process.cwd(), cfg.serviceAccountPath);
    raw = fs.readFileSync(p, "utf-8");
  } else {
    throw new Error("Google service account JSON not configured");
  }
  const sa = JSON.parse(raw) as ServiceAccount;
  if (!sa.client_email || !sa.private_key) {
    throw new Error("Service account JSON missing client_email / private_key");
  }
  sa.private_key = sa.private_key.replace(/\\n/g, "\n");
  return sa;
}

function b64url(data: Buffer | string): string {
  return Buffer.from(data)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function tokenFromServiceAccount(cfg: DriveConfig): Promise<string> {
  const sa = readServiceAccount(cfg);
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/drive",
      aud: sa.token_uri || "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${claim}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const sig = signer.sign(sa.private_key).toString("base64url");
  const jwt = `${unsigned}.${sig}`;

  const res = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`Drive token exchange failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in?: number };
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000,
  };
  return data.access_token;
}

async function tokenFromOauth(cfg: DriveConfig): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.oauthClientId!,
      client_secret: cfg.oauthClientSecret!,
      refresh_token: cfg.oauthRefreshToken!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`Drive OAuth refresh failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in?: number };
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000,
  };
  return data.access_token;
}

async function getAccessToken(cfg: DriveConfig): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.accessToken;
  }
  if (cfg.mode === "service_account") return tokenFromServiceAccount(cfg);
  if (cfg.mode === "oauth") return tokenFromOauth(cfg);
  throw new Error("Google Drive is not configured");
}

async function driveFetch(
  cfg: DriveConfig,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getAccessToken(cfg);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

/** Resolve taxonomy folder ID; optionally create under root when missing. */
export async function resolveDriveFolderId(
  cfg: DriveConfig,
  archiveCategory: number,
): Promise<string> {
  const mapped = cfg.folderIds[archiveCategory];
  if (mapped) return mapped;

  if (!cfg.rootFolderId) {
    throw new Error(
      `No Google Drive folder for taxonomy ${archiveCategory}. Set GOOGLE_DRIVE_FOLDER_${archiveCategory} or GOOGLE_DRIVE_ROOT_FOLDER_ID.`,
    );
  }

  const label =
    ARCHIVE_TAXONOMY[archiveCategory as keyof typeof ARCHIVE_TAXONOMY] ?? "Misc";
  const folderName = `${String(archiveCategory).padStart(2, "0")}_${label}`;

  const q = encodeURIComponent(
    `name='${folderName.replace(/'/g, "\\'")}' and '${cfg.rootFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  const list = await driveFetch(
    cfg,
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=5`,
  );
  if (!list.ok) {
    throw new Error(`Drive folder lookup failed: ${list.status} ${await list.text()}`);
  }
  const listed = (await list.json()) as { files?: Array<{ id: string }> };
  if (listed.files?.[0]?.id) return listed.files[0].id;

  const create = await driveFetch(cfg, "https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [cfg.rootFolderId],
    }),
  });
  if (!create.ok) {
    throw new Error(`Drive folder create failed: ${create.status} ${await create.text()}`);
  }
  const created = (await create.json()) as { id: string };
  return created.id;
}

export async function uploadFileToDrive(opts: {
  localPath: string;
  name: string;
  mimeType: string;
  archiveCategory: number;
}): Promise<DriveUploadResult | null> {
  const cfg = loadDriveConfig();
  if (!cfg.enabled) return null;

  const folderId = await resolveDriveFolderId(cfg, opts.archiveCategory);
  const body = await fsp.readFile(opts.localPath);
  const boundary = `personai_${crypto.randomBytes(12).toString("hex")}`;
  const meta = JSON.stringify({
    name: opts.name,
    parents: [folderId],
  });
  const preamble = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
      `--${boundary}\r\nContent-Type: ${opts.mimeType}\r\n\r\n`,
    "utf-8",
  );
  const closing = Buffer.from(`\r\n--${boundary}--`, "utf-8");
  const multipart = Buffer.concat([preamble, body, closing]);

  const res = await driveFetch(
    cfg,
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body: multipart,
    },
  );
  if (!res.ok) {
    throw new Error(`Drive upload failed: ${res.status} ${await res.text()}`);
  }
  const file = (await res.json()) as { id: string; name: string; webViewLink?: string };
  return {
    fileId: file.id,
    webViewLink: file.webViewLink ?? null,
    folderId,
    name: file.name,
  };
}
