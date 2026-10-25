// Google Sheets push (Drive files.watch) — Edge configuration and limits (plan §17).
// The DATABASE holds the authoritative scope (push_config.mode + the pilot allowlist, checked by every claim, kick
// and registration). GOOGLE_SHEETS_PUSH_ENABLED is the Edge kill switch: unset → notifications are still validated
// and durably queued, but nothing is processed or registered (maintenance only stops channels).

export interface PushConfig {
  enabled: boolean;
  /** HMAC key that tags every channel id we mint (≥ 32 chars). */
  key: string;
  /** Bearer token the maintenance cron must present (≥ 32 chars). */
  maintenanceToken: string;
  /** The receiver URL Google calls, derived from SUPABASE_URL — never from a request. */
  address: string;
}

export const PUSH = {
  jobLeaseS: 300,             // target (job) lease; a crashed worker's job is reclaimable after this
  receiverBudgetMs: 100_000,  // background processing after an acknowledged notification (below the Edge wall clock)
  maintenanceBudgetMs: 100_000,
  apiBudgetMs: 60_000,        // background processing kicked by an owner action
  sourceBudgetMs: 45_000,     // per source run (cooperative, like the worker)
  minSourceBudgetMs: 8_000,   // never start a source run with less than this left
  busyRetries: 3,             // a Sync now holding the source lease: retry in-process before deferring
  busyWaitMs: 3_000,
  channelTtlMs: 86_400_000,   // requested; Google caps file channels at 1 day and returns the real expiration
  googleTimeoutMs: 8_000,
  maintenanceItems: 25,
  maxTargetsPerRun: 25,
} as const;

export function readPushConfig(env: { get(name: string): string | undefined } = Deno.env): PushConfig {
  const url = (env.get("SUPABASE_URL") ?? "").trim().replace(/\/+$/, "");
  return {
    enabled: (env.get("GOOGLE_SHEETS_PUSH_ENABLED") ?? "").trim().toLowerCase() === "true",
    key: (env.get("GOOGLE_SHEETS_PUSH_KEY") ?? "").trim(),
    maintenanceToken: (env.get("GOOGLE_SHEETS_PUSH_MAINTENANCE_TOKEN") ?? "").trim(),
    address: /^https:\/\/[^/?#\s]+$/.test(url) ? `${url}/functions/v1/google-sheets-push` : "",
  };
}

/** Processing and registration need the kill switch on, a strong key and an HTTPS address. */
export const pushReady = (p: PushConfig): boolean => p.enabled && p.key.length >= 32 && p.address !== "";
