import { apiGet, type DriveStatus } from "@/lib/api-client";

let cached: { at: number; value: DriveStatus | null } = { at: 0, value: null };
const TTL_MS = 15_000;

export async function fetchDriveStatus(opts?: { force?: boolean }): Promise<DriveStatus | null> {
  if (!opts?.force && cached.value && Date.now() - cached.at < TTL_MS) {
    return cached.value;
  }
  try {
    const value = await apiGet<DriveStatus>("/archive/drive", { silent: true });
    cached = { at: Date.now(), value };
    return value;
  } catch {
    cached = { at: Date.now(), value: null };
    return null;
  }
}

export function clearDriveStatusCache(): void {
  cached = { at: 0, value: null };
}
