import {
  clearStoredProfileId,
  getStoredApiBaseUrl,
  getStoredProfileId,
  setStoredApiBaseUrl,
  setStoredProfileId,
} from "./platform";

const DEFAULT_API_BASE = "http://localhost:4000";

/** undefined = use storage; null = explicitly logged out; string = active override */
let profileIdOverride: string | null | undefined = undefined;

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

export function getApiBaseUrl(): string {
  if (typeof window !== "undefined") {
    const stored = getStoredApiBaseUrl();
    if (stored) return stored;
  }
  return process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? DEFAULT_API_BASE;
}

export function setApiBaseUrl(url: string): void {
  if (typeof window === "undefined") return;
  setStoredApiBaseUrl(url);
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

function buildHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const profileId = getProfileId();
  if (profileId) {
    headers.set("X-Profile-Id", profileId);
  }
  return headers;
}

async function parseResponse<T>(res: Response): Promise<T> {
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
    const message =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new ApiError(message, res.status, body);
  }
  return body as T;
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    method: "GET",
    headers: buildHeaders(init?.headers),
  });
  return parseResponse<T>(res);
}

export async function apiPost<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    method: "POST",
    headers: buildHeaders(init?.headers),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return parseResponse<T>(res);
}

export async function apiPatch<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    method: "PATCH",
    headers: buildHeaders(init?.headers),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return parseResponse<T>(res);
}

export async function apiPut<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    method: "PUT",
    headers: buildHeaders(init?.headers),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return parseResponse<T>(res);
}

export async function apiDelete<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    method: "DELETE",
    headers: buildHeaders(init?.headers),
  });
  return parseResponse<T>(res);
}

export async function apiUpload<T>(path: string, formData: FormData, init?: RequestInit): Promise<T> {
  const headers = buildHeaders(init?.headers);
  headers.delete("Content-Type");
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    method: "POST",
    headers,
    body: formData,
  });
  return parseResponse<T>(res);
}

export type SSEHandler = {
  onEvent?: (event: string, data: unknown) => void;
  onError?: (error: Error) => void;
  onDone?: () => void;
};

export async function streamSSE(path: string, options: SSEHandler & { method?: string; body?: unknown } = {}): Promise<() => void> {
  const controller = new AbortController();
  const headers = buildHeaders();
  headers.set("Accept", "text/event-stream");

  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: controller.signal,
  });

  if (!res.ok) {
    const err = await parseResponse<never>(res);
    throw err;
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
                const msg = typeof data === "object" && data && "message" in data ? String((data as { message: unknown }).message) : "Stream error";
                options.onError?.(new Error(msg));
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
}

export interface ProfileRegistry {
  activeProfileId: string | null;
  profiles: Profile[];
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
