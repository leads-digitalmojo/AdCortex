export type SyncStatus = "idle" | "loading" | "success" | "failed";

export interface PlatformSyncState {
  last_synced_at: string | null;
  last_successful_fetch: string | null;
  sync_status: SyncStatus;
  status?: SyncStatus;
  error?: string | null;
}

export function parseSyncTimestamp(value?: string | null): Date | null {
  if (!value) return null;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function formatHoursAgo(value?: string | null, nowMs = Date.now()): string | null {
  const parsed = parseSyncTimestamp(value);
  if (!parsed) return null;
  const diffHours = Math.max(0, Math.floor((nowMs - parsed.getTime()) / (1000 * 60 * 60)));
  return `${diffHours}h ago`;
}
