import {
  clearStoredProfileId,
  clearStoredSessionToken,
  getStoredApiBaseUrl,
  getStoredProfileId,
  getStoredSessionToken,
  normalizeApiBaseUrl,
  setStoredApiBaseUrl,
  setStoredProfileId,
  setStoredSessionToken,
} from "./platform";
import { describeApiFailure, describeStreamError } from "./api-errors";
import { notifyApiFailure } from "./toast";

const DEFAULT_API_BASE = "http://localhost:4000";

/** undefined = use storage; null = explicitly logged out; string = active override */
let profileIdOverride: string | null | undefined = undefined;

/** undefined = use storage; null = logged out; string = override */
let sessionTokenOverride: string | null | undefined = undefined;

/** In-memory override so Settings save takes effect before next full reload. */
let apiBaseUrlOverride: string | null | undefined = undefined;

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Extends fetch init — set `silent: true` when the caller shows its own error UI. */
export type ApiRequestInit = RequestInit & { silent?: boolean };

function splitInit(init?: ApiRequestInit): { request: RequestInit; silent: boolean } {
  if (!init) return { request: {}, silent: false };
  const { silent, ...request } = init;
  return { request, silent: Boolean(silent) };
}

async function runNotified<T>(
  fn: () => Promise<T>,
  silent: boolean,
  path?: string,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const described = describeApiFailure(err, { path, apiBaseUrl: getApiBaseUrl() });
    if (!silent) notifyApiFailure(err, { path, apiBaseUrl: getApiBaseUrl() });
    if (err instanceof ApiError) {
      throw new ApiError(described.message, err.status, err.body);
    }
    throw new Error(described.message, { cause: err });
  }
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/** Baked NEXT_PUBLIC only — null when unset so callers can fall through. */
function resolveEnvApiBase(): string | null {
  return normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_URL ?? "");
}

/**
 * When UI is opened on a remote host (e.g. Tailscale MagicDNS) and nothing is
 * configured, assume the matching Serve/Docker API for this page scheme:
 * - https://HOST        → https://HOST:8443  (Tailscale Serve → :4000)
 * - http://HOST[:3000]  → http://HOST:4000
 */
export function getSuggestedApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const host = window.location.hostname;
  if (!host || isLocalHostname(host)) return null;
  if (window.location.protocol === "https:") {
    return normalizeApiBaseUrl(`https://${host}:8443`);
  }
  return normalizeApiBaseUrl(`http://${host}:4000`);
}

/** Plain HTTP API for temporary Drive/setup when Serve :8443 is down (browse-only; not PWA). */
export function getHttpFallbackApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const host = window.location.hostname;
  if (!host || isLocalHostname(host)) return null;
  return normalizeApiBaseUrl(`http://${host}:4000`);
}

/** HTTP Settings origin when HTTPS API/Serve is dead — mixed content blocks http API from https UI. */
export function getHttpFallbackSettingsUrl(): string | null {
  if (typeof window === "undefined") return null;
  const host = window.location.hostname;
  if (!host || isLocalHostname(host)) return null;
  return `http://${host}:3000/settings/`;
}

/** Probe API /health with a short timeout (does not mutate stored base URL). */
export async function probeApiHealth(
  baseUrl: string,
  timeoutMs = 4000,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (typeof window === "undefined") return { ok: false, error: "Not in browser" };
  const base = normalizeApiBaseUrl(baseUrl);
  if (!base) return { ok: false, error: "Invalid API URL" };
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/health`, { method: "GET", signal: ctrl.signal });
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    if (body && body.ok === false) return { ok: false, status: res.status, error: "Health not ok" };
    return { ok: true, status: res.status };
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "AbortError") return { ok: false, error: "Timed out" };
    return { ok: false, error: err instanceof Error ? err.message : "Failed to fetch" };
  } finally {
    window.clearTimeout(timer);
  }
}

export type PreferApiResult = {
  baseUrl: string;
  switched: boolean;
  /** Human hint when HTTPS Serve is down or mixed content blocks HTTP API. */
  reason?: string;
  /** True when the page is HTTPS and cannot call http://:4000 (open HTTP Settings). */
  needsHttpUi?: boolean;
};

/**
 * Prefer a reachable API when Active/baked URL points at dead Serve :8443.
 * On http://HOST:3000, auto-switches to http://HOST:4000 when that health succeeds.
 * On https:// pages, does not mutate (mixed content) — sets needsHttpUi instead.
 */
export async function preferReachableApiBaseUrl(
  timeoutMs = 3500,
): Promise<PreferApiResult> {
  const active = getApiBaseUrl();
  const activeProbe = await probeApiHealth(active, timeoutMs);
  if (activeProbe.ok) return { baseUrl: active, switched: false };

  const httpApi = getHttpFallbackApiBaseUrl();
  const httpSettings = getHttpFallbackSettingsUrl();
  const serveHint =
    "Tailscale Serve may have no config (`tailscale serve status` → No serve config).";

  if (typeof window !== "undefined" && window.location.protocol === "https:") {
    return {
      baseUrl: active,
      switched: false,
      needsHttpUi: true,
      reason:
        `HTTPS API unreachable (${activeProbe.error ?? "failed"}). ${serveHint} ` +
        (httpSettings
          ? `Temporary Drive setup: open ${httpSettings} with API ${httpApi} (not PWA).`
          : `Open http://HOST:3000 and set API to http://HOST:4000.`),
    };
  }

  if (!httpApi || httpApi === active) {
    return {
      baseUrl: active,
      switched: false,
      reason: `${activeProbe.error ?? "API unreachable"}. ${serveHint}`,
    };
  }

  const httpProbe = await probeApiHealth(httpApi, timeoutMs);
  if (!httpProbe.ok) {
    return {
      baseUrl: active,
      switched: false,
      reason:
        `HTTPS API (${active}) failed (${activeProbe.error ?? "failed"}); ` +
        `HTTP fallback ${httpApi} also failed (${httpProbe.error ?? "unreachable"}). ${serveHint}`,
    };
  }

  setApiBaseUrl(httpApi);
  return {
    baseUrl: httpApi,
    switched: true,
    reason:
      `HTTPS API unreachable — switched to ${httpApi}. ${serveHint} ` +
      `Re-enable with: HTTPS=1 ./scripts/vps-tailscale.sh --serve-only <host>`,
  };
}

export function getApiBaseUrl(): string {
  if (typeof window !== "undefined") {
    if (apiBaseUrlOverride !== undefined && apiBaseUrlOverride !== null) {
      return apiBaseUrlOverride;
    }
    const stored = getStoredApiBaseUrl();
    if (stored) return stored;
  }

  const fromEnv = resolveEnvApiBase();
  if (fromEnv) return fromEnv;

  const suggested = getSuggestedApiBaseUrl();
  if (suggested) return suggested;

  return DEFAULT_API_BASE;
}

export function setApiBaseUrl(url: string): void {
  if (typeof window === "undefined") return;
  const normalized = normalizeApiBaseUrl(url);
  apiBaseUrlOverride = normalized;
  if (normalized) {
    setStoredApiBaseUrl(normalized);
  } else {
    setStoredApiBaseUrl("");
  }
}

/** Join base + path without double slashes; path should start with `/`. */
export function apiUrl(path: string): string {
  const base = getApiBaseUrl().replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

/** Append session token for SSE when headers are stripped (EventSource / proxies). */
function withAccessTokenQuery(path: string): string {
  const token = getSessionToken();
  if (!token) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}access_token=${encodeURIComponent(token)}`;
}

export function getProfileId(): string | null {
  if (profileIdOverride !== undefined) return profileIdOverride;
  return getStoredProfileId();
}

export function setProfileId(id: string | null): void {
  profileIdOverride = id;
  if (typeof window === "undefined") return;
  if (id) {
    setStoredProfileId(id);
  } else {
    clearStoredProfileId();
  }
}

export function getSessionToken(): string | null {
  if (sessionTokenOverride !== undefined) return sessionTokenOverride;
  return getStoredSessionToken();
}

export function setSessionToken(token: string | null): void {
  sessionTokenOverride = token;
  if (typeof window === "undefined") return;
  if (token) {
    setStoredSessionToken(token);
  } else {
    clearStoredSessionToken();
  }
}

function buildHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const profileId = getProfileId();
  if (profileId) {
    headers.set("X-Profile-Id", profileId);
  }
  const token = getSessionToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

function maybeRedirectOnAuthFailure(status: number, path: string): void {
  if (typeof window === "undefined") return;
  if (status !== 401 && status !== 403) return;
  // Avoid loops on the public profiles / auth endpoints.
  if (path.startsWith("/auth/") || path.startsWith("/profiles")) return;
  if (window.location.pathname.startsWith("/profiles")) return;
  setSessionToken(null);
  setProfileId(null);
  window.location.replace("/profiles/");
}

async function parseResponse<T>(res: Response, path?: string): Promise<T> {
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    if (path) maybeRedirectOnAuthFailure(res.status, path);
    const message =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new ApiError(message, res.status, body);
  }
  return body as T;
}

export async function apiGet<T>(path: string, init?: ApiRequestInit): Promise<T> {
  const { request, silent } = splitInit(init);
  return runNotified(async () => {
    const res = await fetch(apiUrl(path), {
      ...request,
      method: "GET",
      headers: buildHeaders(request.headers),
    });
    return parseResponse<T>(res, path);
  }, silent, path);
}

export async function apiPost<T>(path: string, body?: unknown, init?: ApiRequestInit): Promise<T> {
  const { request, silent } = splitInit(init);
  return runNotified(async () => {
    const res = await fetch(apiUrl(path), {
      ...request,
      method: "POST",
      headers: buildHeaders(request.headers),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return parseResponse<T>(res, path);
  }, silent, path);
}

export async function apiPatch<T>(path: string, body?: unknown, init?: ApiRequestInit): Promise<T> {
  const { request, silent } = splitInit(init);
  return runNotified(async () => {
    const res = await fetch(apiUrl(path), {
      ...request,
      method: "PATCH",
      headers: buildHeaders(request.headers),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return parseResponse<T>(res, path);
  }, silent, path);
}

export async function apiPut<T>(path: string, body?: unknown, init?: ApiRequestInit): Promise<T> {
  const { request, silent } = splitInit(init);
  return runNotified(async () => {
    const res = await fetch(apiUrl(path), {
      ...request,
      method: "PUT",
      headers: buildHeaders(request.headers),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return parseResponse<T>(res, path);
  }, silent, path);
}

export async function apiDelete<T>(path: string, init?: ApiRequestInit): Promise<T> {
  const { request, silent } = splitInit(init);
  return runNotified(async () => {
    const res = await fetch(apiUrl(path), {
      ...request,
      method: "DELETE",
      headers: buildHeaders(request.headers),
    });
    return parseResponse<T>(res, path);
  }, silent, path);
}

export async function apiUpload<T>(path: string, formData: FormData, init?: ApiRequestInit): Promise<T> {
  const { request, silent } = splitInit(init);
  return runNotified(async () => {
    const headers = buildHeaders(request.headers);
    headers.delete("Content-Type");
    const res = await fetch(apiUrl(path), {
      ...request,
      method: "POST",
      headers,
      body: formData,
    });
    return parseResponse<T>(res, path);
  }, silent, path);
}

export type ApiBlobResult = {
  blob: Blob;
  contentType: string;
  filename: string | null;
};

/** Authenticated binary GET (document preview / download). Does not force JSON Content-Type. */
export async function apiGetBlob(path: string, init?: ApiRequestInit): Promise<ApiBlobResult> {
  const { request, silent } = splitInit(init);
  return runNotified(async () => {
    const headers = buildHeaders(request.headers);
    headers.delete("Content-Type");
    headers.set("Accept", "*/*");
    const res = await fetch(apiUrl(path), {
      ...request,
      method: "GET",
      headers,
    });
    if (!res.ok) {
      maybeRedirectOnAuthFailure(res.status, path);
      const text = await res.text();
      let body: unknown = text;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        /* keep text */
      }
      const message =
        typeof body === "object" && body !== null && "error" in body
          ? String((body as { error: unknown }).error)
          : `Request failed (${res.status})`;
      throw new ApiError(message, res.status, body);
    }
    const cd = res.headers.get("Content-Disposition") ?? "";
    const quoted = cd.match(/filename="([^"]+)"/i);
    const plain = cd.match(/filename=([^;]+)/i);
    const filename = (quoted?.[1] ?? plain?.[1] ?? null)?.trim() || null;
    return {
      blob: await res.blob(),
      contentType: res.headers.get("Content-Type") ?? "application/octet-stream",
      filename,
    };
  }, silent, path);
}

export type SSEHandler = {
  onEvent?: (event: string, data: unknown) => void;
  onError?: (error: Error) => void;
  onDone?: () => void;
};

export async function streamSSE(
  path: string,
  options: SSEHandler & { method?: string; body?: unknown; silent?: boolean } = {},
): Promise<() => void> {
  const controller = new AbortController();
  const headers = buildHeaders();
  headers.set("Accept", "text/event-stream");
  const silent = Boolean(options.silent);

  let res: Response;
  try {
    res = await fetch(apiUrl(withAccessTokenQuery(path)), {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    const described = describeApiFailure(err, { path, apiBaseUrl: getApiBaseUrl() });
    if (!silent) notifyApiFailure(err, { path, apiBaseUrl: getApiBaseUrl() });
    // Human message so silent callers (outbox / chat "Not sent") show a real cause.
    throw new Error(described.message, { cause: err });
  }

  if (!res.ok) {
    let parsedErr: unknown;
    try {
      await parseResponse<never>(res, path);
    } catch (err) {
      parsedErr = err;
    }
    const described = describeApiFailure(parsedErr ?? new Error(`Request failed (${res.status})`), {
      path,
      apiBaseUrl: getApiBaseUrl(),
    });
    if (!silent) {
      notifyApiFailure(parsedErr ?? new Error(described.message), {
        path,
        apiBaseUrl: getApiBaseUrl(),
      });
    }
    if (parsedErr instanceof ApiError) {
      throw new ApiError(described.message, parsedErr.status, parsedErr.body);
    }
    throw new Error(described.message, { cause: parsedErr });
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("No response body for SSE stream");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  void (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          if (!chunk.trim()) continue;
          let event = "message";
          let dataStr = "";
          for (const line of chunk.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            if (line.startsWith("data:")) dataStr += line.slice(5).trim();
          }
          if (dataStr) {
            try {
              const data = JSON.parse(dataStr);
              options.onEvent?.(event, data);
              if (event === "done") options.onDone?.();
              if (event === "error") {
                options.onError?.(new Error(describeStreamError(data)));
              }
            } catch {
              options.onEvent?.(event, dataStr);
            }
          }
        }
      }
      options.onDone?.();
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        options.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }
  })();

  return () => controller.abort();
}

// Domain types
export interface Profile {
  id: string;
  name: string;
  avatar?: string;
  createdAt: string;
  hasPassword?: boolean;
  dbEncrypted?: boolean;
}

export interface ProfileRegistry {
  activeProfileId: string | null;
  profiles: Profile[];
}

export interface AuthResponse {
  token: string;
  profile: Profile;
}

export type HabitFrequency = "DAILY" | "WEEKLY" | "CUSTOM";
export type PersonalGoalStatus = "ACTIVE" | "PAUSED" | "COMPLETED" | "ABANDONED";
export type PersonalTaskStatus = "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED";
export type LifeDomain = "PERSONAL" | "BUSINESS" | "BOTH";

export interface HabitLog {
  id: string;
  habitId: string;
  loggedAt: string;
  note?: string | null;
}

export interface Habit {
  id: string;
  title: string;
  description?: string | null;
  frequency: HabitFrequency;
  customRule?: string | null;
  domain: LifeDomain;
  active: boolean;
  targetCount: number;
  createdAt: string;
  updatedAt: string;
  logs?: HabitLog[];
}

export interface PersonalGoal {
  id: string;
  title: string;
  description?: string | null;
  status: PersonalGoalStatus;
  domain: LifeDomain;
  targetDate?: string | null;
  progress: number;
  createdAt: string;
  updatedAt: string;
  tasks?: PersonalTask[];
}

export interface PersonalTask {
  id: string;
  title: string;
  description?: string | null;
  status: PersonalTaskStatus;
  domain: LifeDomain;
  dueDate?: string | null;
  completedAt?: string | null;
  goalId?: string | null;
  goal?: PersonalGoal | null;
  createdAt: string;
  updatedAt: string;
}

export interface RelationshipTouchpoint {
  id: string;
  contactName: string;
  relationship?: string | null;
  domain: LifeDomain;
  cadenceDays: number;
  lastContactedAt?: string | null;
  nextDueAt?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PersonalNote {
  id: string;
  title?: string | null;
  body: string;
  domain: LifeDomain;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LifestyleMetric {
  id: string;
  key: string;
  label?: string | null;
  value: number;
  unit?: string | null;
  recordedAt: string;
  note?: string | null;
  createdAt: string;
}

export interface PersonalTodaySummary {
  habitsDueToday: number;
  habitsCompletedToday: number;
  habitsPending: Array<{ id: string; title: string }>;
  tasksDueToday: Array<{ id: string; title: string }>;
  overdueTasks: number;
  touchpointsDue: Array<{ id: string; contactName: string }>;
  activeGoals: number;
  recentNotes: number;
  latestMetrics: Array<{ key: string; value: number; unit: string | null; recordedAt: string }>;
}

export interface BriefingSnapshot {
  greeting: string;
  finance: {
    /** null when no expense activity — template category limits are not spendable cash */
    budgetRemainingChf: number | null;
    budgetIsTemplateOnly?: boolean;
    monthlyLimitChf?: number;
    spentThisMonthChf?: number;
    billsDueToday: Array<{ creditor: string; amount: number }>;
    billsDueThisWeek: number;
    recentTransactions: number;
  };
  legal: {
    tasksDueToday: Array<{ title: string; type: string }>;
    overdueTasks: number;
    upcomingThisWeek: number;
  };
  medical: {
    recentComplaints: number;
    avgMoodScore7d: number | null;
    notableTrend: string | null;
  };
  ingest: {
    queuedJobs: number;
    completedYesterday: number;
  };
  /** Present after Personal manners roll-out; older snapshots may omit it. */
  personal?: PersonalTodaySummary;
  /** Compact CEO card + bounded memory facts. */
  userCare?: {
    ceo: CeoProfile;
    memoryFacts: MemoryFact[];
  };
}

export type UsageMode = "PERSONAL" | "BUSINESS" | "BOTH";

export interface CeoProfile {
  id?: string;
  displayName: string | null;
  company: string | null;
  /** App focus — default PERSONAL for new profiles. */
  usageMode?: UsageMode;
  locale: string | null;
  language: string | null;
  timezone: string | null;
  briefHour: string | null;
  notes: string | null;
  /** Optional Home widget layout JSON string (synced from Customize Home). */
  dashboardLayout?: string | null;
  updatedAt?: string;
}

export interface MemoryFact {
  id?: string;
  key: string;
  value: string;
  source: string | null;
  specialistId: string | null;
  updatedAt: string;
  createdAt?: string;
}

export interface DriveStatus {
  configured: boolean;
  enabled: boolean;
  linked: boolean;
  mode: "service_account" | "oauth" | "none";
  rootFolderId: string | null;
  folderCount: number;
  canStartOauth: boolean;
  oauthRedirectUri: string | null;
  serviceAccountEmail: string | null;
  message: string;
  archiveContext?: {
    ready: boolean;
    refreshedAt: string | null;
    indexPreview: string | null;
  };
}

export interface DriveOauthStart {
  url: string;
  redirectUri: string | null;
  state: string;
}

export interface ArchiveRefreshResult {
  ok: boolean;
  linked: boolean;
  folderCount: number;
  fileCount: number;
  model: string | null;
  message: string;
  status?: DriveStatus;
}


export interface TaxonomyHealthFolder {
  id: string;
  name: string;
  fileCount: number;
  isPersonAiStyle: boolean;
}

export interface TaxonomyHealthIssue {
  category: number;
  label: string;
  suggested: TaxonomyHealthFolder;
  duplicates: TaxonomyHealthFolder[];
  reason: string;
  cachedFolderId: string | null;
  cachedMatchesSuggested: boolean;
}

export interface TaxonomyHealthMapping {
  category: number;
  label: string;
  folderId: string | null;
  folderName: string | null;
  source: string | null;
  hasDuplicates: boolean;
}

export interface TaxonomyHealthReport {
  rootFolderId: string | null;
  scannedAt: string;
  childFolderCount: number;
  issues: TaxonomyHealthIssue[];
  mappings: TaxonomyHealthMapping[];
  neverDeletesFolders: true;
  note: string;
}

export interface TaxonomyHealthPreferResult {
  ok: true;
  category: number;
  folderId: string;
  folderName: string | null;
  report: TaxonomyHealthReport;
}

export interface DailyBriefing {
  id: string;
  briefingDate: string;
  status: "PENDING" | "GENERATING" | "READY" | "FAILED";
  snapshot: BriefingSnapshot;
  narrative: string | null;
  tier?: string;
}

export interface IngestionJob {
  id: string;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  documentId: string;
  errorMessage?: string | null;
  pausedReason?: string | null;
  createdAt: string;
  document: {
    id: string;
    filename: string;
    mimeType: string;
    fileSize: number;
  };
}

export interface BudgetCategoryOverview {
  id: string;
  name: string;
  monthlyLimit: number | null;
  color: string | null;
  spent: number;
  /** null when category has no spend this month (limit is a template only) */
  remaining: number | null;
}

export interface QRBill {
  id: string;
  creditorName: string;
  iban: string;
  amount: number;
  currency: string;
  reference?: string | null;
  dueDate?: string | null;
  status: "PENDING" | "PAID" | "OVERDUE" | "CANCELLED";
  notes?: string | null;
}

export interface Transaction {
  id: string;
  type: "INCOME" | "EXPENSE" | "TRANSFER";
  amount: number;
  currency: string;
  description: string;
  date: string;
  category?: { id: string; name: string; color?: string | null } | null;
}

export interface LegalTask {
  id: string;
  title: string;
  description?: string | null;
  type: "TAX" | "FILING" | "CONTRACT" | "REVIEW" | "DEADLINE" | "COMPLIANCE" | "OTHER";
  status: "TODO" | "IN_PROGRESS" | "DONE" | "BLOCKED";
  dueDate?: string | null;
}

export interface ComplaintLog {
  id: string;
  category: "PHYSICAL" | "PSYCHOLOGICAL" | "BOTH";
  title: string;
  description: string;
  bodyRegion?: string | null;
  severity: "MILD" | "MODERATE" | "SEVERE";
  moodScore?: number | null;
  sleepHours?: number | null;
  triggers?: string | null;
  occurredAt: string;
  analyses?: MedicalAnalysis[];
}

export interface MedicalAnalysis {
  id: string;
  framework: "WESTERN" | "EASTERN" | "COMBINED";
  result: string;
  disclaimer: string;
  createdAt: string;
}

export type OllamaRuntime = "native" | "docker" | "remote" | "unknown";

export interface OllamaCandidateStatus {
  host: string;
  up: boolean;
  runtime: OllamaRuntime;
}

export interface OllamaHealth {
  ok: boolean;
  host?: string;
  configuredHost?: string;
  lastKnownGood?: string | null;
  runtime?: OllamaRuntime;
  apiInDocker?: boolean;
  models?: string[];
  running?: string[];
  candidates?: string[];
  candidatesUp?: string[];
  candidateStatus?: OllamaCandidateStatus[];
  /** True when a healthy host is reachable via failover / multiple candidates. */
  failoverOk?: boolean;
  hints?: {
    native: string;
    dockerFromApi: string;
    composeService: string;
  };
  reachable?: boolean;
  note?: string;
  vram?: {
    holder: string | null;
    waiting: number;
    pausedReason: string | null;
  };
}

export interface LicenseInfo {
  tier: string;
  features: {
    aiNarrative: boolean;
    ocr: boolean;
    advisorChat: boolean;
    dualMedicalAnalysis: boolean;
    teamChat?: boolean;
    careerPdf?: boolean;
  };
}

export interface PendingConfirmation {
  id: string;
  action: string;
  summary: string;
  payload: unknown;
  entity?: string | null;
  entityId?: string | null;
  status: "pending" | "confirmed" | "rejected" | "expired";
  createdAt: string;
  resolvedAt?: string | null;
}

export interface SpecialistInfo {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  group: "ops" | "code" | "care" | "coaching";
}
