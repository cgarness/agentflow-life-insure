// Google Sheets lead import — configuration and processing limits (plan §0.1 D9, §0.7).
// Secrets are read from the Edge environment only; nothing here is ever returned to a browser.

export const SHEETS_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/drive.file"] as const;
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export const LIMITS = {
  maxDataRows: 10_000,      // per selected tab; exceeding → Needs review, never truncated
  rowsPerRun: 500,          // new rows ingested per source per run
  ingestBatch: 50,          // rows per atomic ingest call
  pendingBatch: 500,        // pending/clear records per call
  sourcesPerTick: 10,       // sources claimed per worker invocation
  workerBudgetMs: 45_000,   // wall-clock budget per worker invocation
  manualBudgetMs: 25_000,   // Sync now budget (inside a user request)
  previewRows: 20,
  maxColumns: 200,
  overflowHeaderNames: 50, // names reported for headers past maxColumns (mapping screen only)
} as const;

export interface SheetsConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  allowedOrigins: string[];
  stateKey: string;
  workerToken: string;
}

export function readConfig(env: { get(name: string): string | undefined } = Deno.env): SheetsConfig {
  const origins = (env.get("GOOGLE_SHEETS_ALLOWED_RETURN_ORIGINS") ?? "")
    .split(",").map((o) => o.trim().replace(/\/+$/, "")).filter((o) => /^https:\/\/[^/?#\s]+$/.test(o));
  return {
    enabled: (env.get("GOOGLE_SHEETS_ENABLED") ?? "").trim().toLowerCase() === "true",
    clientId: (env.get("GOOGLE_SHEETS_CLIENT_ID") ?? "").trim(),
    clientSecret: (env.get("GOOGLE_SHEETS_CLIENT_SECRET") ?? "").trim(),
    redirectUri: (env.get("GOOGLE_SHEETS_REDIRECT_URI") ?? "").trim(),
    allowedOrigins: origins,
    stateKey: (env.get("GOOGLE_SHEETS_STATE_KEY") ?? "").trim(),
    workerToken: (env.get("GOOGLE_SHEETS_WORKER_TOKEN") ?? "").trim(),
  };
}

/** True when every OAuth secret the connect flow needs is present. */
export function oauthConfigured(c: SheetsConfig): boolean {
  return Boolean(c.clientId && c.clientSecret && /^https:\/\//.test(c.redirectUri) && c.stateKey.length >= 32 &&
    c.allowedOrigins.length > 0);
}
