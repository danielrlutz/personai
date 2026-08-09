/**
 * Optional Google Drive upload + archive listing (Harmonia-style folder IDs).
 * When credentials / folder IDs are missing, callers get a disabled status — never fake files.
 *
 * Link modes:
 * - service_account: Settings vault JSON (+ optional per-profile root folder prefs)
 * - oauth: Settings vault client id/secret + per-profile refresh token from Link Google Drive
 * Env remains bootstrap-only fallback.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { ARCHIVE_TAXONOMY } from "../specialists/roster.js";
import { getActiveProfileId } from "../db/prisma-singleton.js";
import { resolveProductConfig } from "../settings/host-vault.js";
import {
  readDriveOauthStore,
  readDrivePrefs,
  writeDriveOauthStore,
  type DriveOauthStore,
} from "./drive-oauth-store.js";

export type DriveConfig = {
  enabled: boolean;
  mode: "service_account" | "oauth" | "none";
  linked: boolean;
  rootFolderId: string | null;
  folderIds: Record<number, string>;
  serviceAccountPath: string | null;
  serviceAccountJson: string | null;
  oauthClientId: string | null;
  oauthClientSecret: string | null;
  oauthRefreshToken: string | null;
  oauthRedirectUri: string | null;
  canStartOauth: boolean;
  serviceAccountEmail: string | null;
  profileId: string | null;
};

export type DriveUploadResult = {
  fileId: string;
  webViewLink: string | null;
  folderId: string;
  name: string;
};

export type DriveFileIndexEntry = {
  id: string;
  name: string;
  folderLabel: string;
  archiveCategory: number | null;
  modifiedTime: string | null;
  webViewLink: string | null;
};

type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

let cachedToken: { accessToken: string; expiresAt: number; key: string } | null = null;

function oauthRedirectUriFromEnv(): string | null {
  const product = resolveProductConfig();
  const explicit = product.googleOauthRedirectUri;
  if (explicit) return explicit.replace(/\/$/, "");
  const publicApi = product.publicApiUrl;
  if (publicApi) {
    return `${publicApi.replace(/\/$/, "")}/archive/drive/oauth/callback`;
  }
  return `http://127.0.0.1:${process.env.PORT ?? 4000}/archive/drive/oauth/callback`;
}

function webAppBaseUrl(): string {
  return resolveProductConfig().publicWebUrl;
}

export function getWebAppBaseUrl(): string {
  return webAppBaseUrl();
}

export function loadDriveConfig(profileId?: string | null): DriveConfig {
  const pid = profileId ?? getActiveProfileId();
  const product = resolveProductConfig();
  const folderIds: Record<number, string> = { ...product.googleDriveFolderIds };

  const serviceAccountPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() || null;
  const serviceAccountJson = product.googleServiceAccountJson;
  const oauthClientId = product.googleOauthClientId;
  const oauthClientSecret = product.googleOauthClientSecret;
  const envOauthRefresh = process.env.GOOGLE_OAUTH_REFRESH_TOKEN?.trim() || null;
  const envRoot = product.googleDriveRootFolderId;

  const storedOauth = pid ? readDriveOauthStore(pid) : null;
  const prefs = pid ? readDrivePrefs(pid) : null;
  const oauthRefreshToken = storedOauth?.refreshToken || envOauthRefresh || null;
  const rootFolderId =
    storedOauth?.rootFolderId?.trim() ||
    prefs?.rootFolderId?.trim() ||
    envRoot ||
    null;

  const hasSa = Boolean(serviceAccountPath || serviceAccountJson);
  const hasOauth = Boolean(oauthClientId && oauthClientSecret && oauthRefreshToken);
  const canStartOauth = Boolean(oauthClientId && oauthClientSecret);
  const forceOff = ["0", "false", "no", "off"].includes(
    (process.env.GOOGLE_DRIVE_ENABLED ?? "").trim().toLowerCase(),
  );
  const forceOn = ["1", "true", "yes", "on"].includes(
    (process.env.GOOGLE_DRIVE_ENABLED ?? "").trim().toLowerCase(),
  );

  // Prefer user OAuth link over SA when both present.
  const mode: DriveConfig["mode"] = hasOauth
    ? "oauth"
    : hasSa
      ? "service_account"
      : "none";
  const hasFolders = Boolean(rootFolderId) || Object.keys(folderIds).length > 0;
  const enabled = !forceOff && (forceOn || mode !== "none") && mode !== "none";
  // `enabled` already implies mode !== "none" (TS narrows mode after that).
  const linked = enabled && hasFolders;

  let serviceAccountEmail: string | null = null;
  if (hasSa) {
    try {
      serviceAccountEmail = readServiceAccount({
        enabled,
        mode: "service_account",
        linked,
        rootFolderId,
        folderIds,
        serviceAccountPath,
        serviceAccountJson,
        oauthClientId,
        oauthClientSecret,
        oauthRefreshToken,
        oauthRedirectUri: oauthRedirectUriFromEnv(),
        canStartOauth,
        serviceAccountEmail: null,
        profileId: pid,
      }).client_email;
    } catch {
      serviceAccountEmail = null;
    }
  }

  return {
    enabled,
    mode: enabled ? mode : "none",
    linked,
    rootFolderId,
    folderIds,
    serviceAccountPath,
    serviceAccountJson,
    oauthClientId,
    oauthClientSecret,
    oauthRefreshToken,
    oauthRedirectUri: oauthRedirectUriFromEnv(),
    canStartOauth,
    serviceAccountEmail,
    profileId: pid,
  };
}

export function driveStatus(profileId?: string | null): {
  configured: boolean;
  enabled: boolean;
  linked: boolean;
  mode: DriveConfig["mode"];
  rootFolderId: string | null;
  folderCount: number;
  taxonomy: typeof ARCHIVE_TAXONOMY;
  canStartOauth: boolean;
  oauthRedirectUri: string | null;
  serviceAccountEmail: string | null;
  message: string;
} {
  const cfg = loadDriveConfig(profileId);
  const message = !cfg.enabled
    ? cfg.canStartOauth
      ? "Google Drive is not linked yet. Open Settings → Link Google Drive."
      : cfg.serviceAccountEmail
        ? "Service account JSON is present, but Drive is disabled or missing a root/taxonomy folder."
        : "Google Drive is not configured. Add OAuth client credentials or a service account, then link."
    : !cfg.linked
      ? "Drive credentials are present, but no archive root or taxonomy folders are set."
      : cfg.mode === "oauth"
        ? "Google Drive is linked (your Google account)."
        : `Google Drive is linked (service account${cfg.serviceAccountEmail ? `: ${cfg.serviceAccountEmail}` : ""}).`;

  return {
    configured: cfg.mode !== "none",
    enabled: cfg.enabled,
    linked: cfg.linked,
    mode: cfg.mode,
    rootFolderId: cfg.rootFolderId,
    folderCount: Object.keys(cfg.folderIds).length,
    taxonomy: ARCHIVE_TAXONOMY,
    canStartOauth: cfg.canStartOauth,
    oauthRedirectUri: cfg.oauthRedirectUri,
    serviceAccountEmail: cfg.serviceAccountEmail,
    message,
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
    key: `sa:${sa.client_email}`,
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
    key: `oauth:${cfg.profileId ?? "env"}`,
  };
  return data.access_token;
}

async function getAccessToken(cfg: DriveConfig): Promise<string> {
  const key =
    cfg.mode === "service_account"
      ? `sa:${cfg.serviceAccountEmail ?? "x"}`
      : `oauth:${cfg.profileId ?? "env"}`;
  if (cachedToken && cachedToken.key === key && cachedToken.expiresAt > Date.now()) {
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

export function buildOauthConsentUrl(state: string): string {
  const cfg = loadDriveConfig();
  if (!cfg.oauthClientId || !cfg.oauthRedirectUri) {
    throw new Error(
      "OAuth is not available. Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and optionally GOOGLE_OAUTH_REDIRECT_URI.",
    );
  }
  const params = new URLSearchParams({
    client_id: cfg.oauthClientId,
    redirect_uri: cfg.oauthRedirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/drive",
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeOauthCode(code: string): Promise<{
  refreshToken: string;
  accessToken: string;
  expiresIn: number;
}> {
  const cfg = loadDriveConfig();
  if (!cfg.oauthClientId || !cfg.oauthClientSecret || !cfg.oauthRedirectUri) {
    throw new Error("OAuth client is not configured on the server");
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.oauthClientId,
      client_secret: cfg.oauthClientSecret,
      redirect_uri: cfg.oauthRedirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`Drive OAuth code exchange failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    refresh_token?: string;
    access_token: string;
    expires_in?: number;
  };
  if (!data.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Revoke PersonAI access in Google Account → Security → Third-party access, then link again.",
    );
  }
  return {
    refreshToken: data.refresh_token,
    accessToken: data.access_token,
    expiresIn: data.expires_in ?? 3600,
  };
}

async function ensurePersonAiRootFolder(cfg: DriveConfig): Promise<string> {
  if (cfg.rootFolderId) return cfg.rootFolderId;
  const q = encodeURIComponent(
    "name='PersonAI_Archive' and 'root' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false",
  );
  const list = await driveFetch(
    cfg,
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=5`,
  );
  if (!list.ok) {
    throw new Error(`Drive root lookup failed: ${list.status} ${await list.text()}`);
  }
  const listed = (await list.json()) as { files?: Array<{ id: string }> };
  if (listed.files?.[0]?.id) return listed.files[0].id;

  const create = await driveFetch(cfg, "https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "PersonAI_Archive",
      mimeType: "application/vnd.google-apps.folder",
    }),
  });
  if (!create.ok) {
    throw new Error(`Drive root create failed: ${create.status} ${await create.text()}`);
  }
  const created = (await create.json()) as { id: string };
  return created.id;
}

export async function completeOauthLink(opts: {
  profileId: string;
  refreshToken: string;
  accessToken?: string;
}): Promise<DriveConfig> {
  const now = new Date().toISOString();
  const draft: DriveOauthStore = {
    refreshToken: opts.refreshToken,
    accessToken: opts.accessToken ?? null,
    linkedAt: now,
    updatedAt: now,
    rootFolderId: readDriveOauthStore(opts.profileId)?.rootFolderId ?? null,
  };
  writeDriveOauthStore(opts.profileId, draft);
  cachedToken = null;

  const cfg = loadDriveConfig(opts.profileId);
  if (!cfg.rootFolderId) {
    const rootId = await ensurePersonAiRootFolder(cfg);
    writeDriveOauthStore(opts.profileId, { ...draft, rootFolderId: rootId });
  }
  return loadDriveConfig(opts.profileId);
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
      `No Google Drive folder for taxonomy ${archiveCategory}. Set GOOGLE_DRIVE_FOLDER_${archiveCategory} or GOOGLE_DRIVE_ROOT_FOLDER_ID, or Link Google Drive in Settings.`,
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

export async function listDriveArchiveFiles(opts?: {
  profileId?: string | null;
  perFolder?: number;
}): Promise<{
  linked: boolean;
  folders: Array<{ archiveCategory: number; label: string; folderId: string; fileCount: number }>;
  files: DriveFileIndexEntry[];
}> {
  const cfg = loadDriveConfig(opts?.profileId);
  if (!cfg.enabled || cfg.mode === "none") {
    return { linked: false, folders: [], files: [] };
  }
  const perFolder = opts?.perFolder ?? 12;
  const folders: Array<{
    archiveCategory: number;
    label: string;
    folderId: string;
    fileCount: number;
  }> = [];
  const files: DriveFileIndexEntry[] = [];

  for (let cat = 1; cat <= 10; cat++) {
    const label = ARCHIVE_TAXONOMY[cat as keyof typeof ARCHIVE_TAXONOMY] ?? "Misc";
    let folderId: string;
    try {
      folderId = await resolveDriveFolderId(cfg, cat);
    } catch {
      continue;
    }
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const list = await driveFetch(
      cfg,
      `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=modifiedTime desc&pageSize=${perFolder}&fields=files(id,name,modifiedTime,webViewLink)`,
    );
    if (!list.ok) {
      throw new Error(`Drive list failed for ${label}: ${list.status} ${await list.text()}`);
    }
    const listed = (await list.json()) as {
      files?: Array<{ id: string; name: string; modifiedTime?: string; webViewLink?: string }>;
    };
    const rows = listed.files ?? [];
    folders.push({
      archiveCategory: cat,
      label: `${String(cat).padStart(2, "0")}_${label}`,
      folderId,
      fileCount: rows.length,
    });
    for (const f of rows) {
      files.push({
        id: f.id,
        name: f.name,
        folderLabel: `${String(cat).padStart(2, "0")}_${label}`,
        archiveCategory: cat,
        modifiedTime: f.modifiedTime ?? null,
        webViewLink: f.webViewLink ?? null,
      });
    }
  }

  return { linked: cfg.linked, folders, files };
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

export async function verifyDriveConnection(profileId?: string | null): Promise<{
  ok: boolean;
  linked: boolean;
  mode: DriveConfig["mode"];
  rootFolderId: string | null;
  message: string;
}> {
  const cfg = loadDriveConfig(profileId);
  if (cfg.mode === "none") {
    return {
      ok: false,
      linked: false,
      mode: "none",
      rootFolderId: null,
      message: driveStatus(profileId).message,
    };
  }
  try {
    await getAccessToken(cfg);
    let root = cfg.rootFolderId;
    if (!root && cfg.mode === "oauth") {
      root = await ensurePersonAiRootFolder(cfg);
      if (cfg.profileId) {
        const existing = readDriveOauthStore(cfg.profileId);
        if (existing) {
          writeDriveOauthStore(cfg.profileId, { ...existing, rootFolderId: root });
        }
      }
    }
    return {
      ok: true,
      linked: Boolean(root) || Object.keys(cfg.folderIds).length > 0,
      mode: cfg.mode,
      rootFolderId: root,
      message: "Drive connection works.",
    };
  } catch (err) {
    return {
      ok: false,
      linked: false,
      mode: cfg.mode,
      rootFolderId: cfg.rootFolderId,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
