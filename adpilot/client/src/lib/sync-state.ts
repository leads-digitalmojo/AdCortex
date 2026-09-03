export type SyncStatus = "idle" | "loading" | "success" | "failed";

export interface PlatformSyncState {
  last_synced_at: string | null;
  last_successful_fetch: string | null;
  sync_status: SyncStatus;
  error?: string | null;
}

export function parseSyncTimestamp(value?: string | null): Date | null {
  if (!value) return null;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

/** Raw hours since `value`, or null if unparseable. Used to grade staleness severity. */
export function hoursSince(value?: string | null, nowMs = Date.now()): number | null {
  const parsed = parseSyncTimestamp(value);
  if (!parsed) return null;
  return Math.max(0, (nowMs - parsed.getTime()) / (1000 * 60 * 60));
}

export function formatHoursAgo(value?: string | null, nowMs = Date.now()): string | null {
  const diffHours = hoursSince(value, nowMs);
  if (diffHours === null) return null;
  return `${Math.floor(diffHours)}h ago`;
}

export type StalenessLevel = "fresh" | "aging" | "stale";

/**
 * Grades data age against a cadence's expected refresh window, so a "72h ago" badge
 * looks visibly more urgent than "2h ago" instead of both rendering as identical
 * muted text. Thresholds are generous multiples of the fastest (daily) cadence —
 * a monthly-cadence client's data is legitimately older and shouldn't false-alarm.
 */
export function gradeStaleness(hoursAgo: number | null): StalenessLevel {
  if (hoursAgo === null) return "fresh";
  if (hoursAgo > 48) return "stale";
  if (hoursAgo > 24) return "aging";
  return "fresh";
}
