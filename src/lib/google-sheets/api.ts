import { supabase } from "@/integrations/supabase/client";

/** Server error codes → concise copy. Never shows raw server text. */
const MESSAGES: Record<string, string> = {
  not_permitted: "Your role can't import from Google Sheets.",
  not_connected: "Connect Google first.",
  reconnect_required: "Google access expired. Reconnect to continue.",
  duplicate_source: "This tab is already added.",
  version_conflict: "This sheet changed in another window. Reopen it and try again.",
  identity_change_requires_review: "Changing the Lead ID column needs a review.",
  access_lost: "AgentFlow can't open this sheet. Pick it again.",
  tab_missing: "That tab no longer exists.",
  too_large: "This tab has more than 10,000 rows.",
  rate_limited: "Google is busy. Try again in a minute.",
  api_not_enabled: "Google Sheets isn't set up for AgentFlow yet.",
  not_a_spreadsheet: "Pick a Google Sheets file.",
  custom_field_unavailable: "A mapped custom field is no longer available.",
  busy: "A check is already running. Try again shortly.",
  review_changed: "The sheet changed since you opened this review. Check the rows again.",
  connection_changed: "Your Google connection changed. Check the rows again.",
  invalid_state: "This sheet no longer needs this review.",
  disabled: "Google Sheets is not available yet.",
  unauthorized: "Your session expired. Sign in again.",
  origin_not_allowed: "Connecting isn't available from this address.",
  // Mapping v2 (only the updated mapping screen can receive these)
  mapping_version_unavailable: "The updated column mapping isn't available yet. Reload the page and try again.",
  unacknowledged_columns: "The sheet's columns changed since the preview. Review them, then save again.",
  inspection_incomplete: "Couldn't finish checking the sheet's columns. Try again.",
  ignored_header_mapped: "A column can't be both imported and ignored.",
};

export class SheetsApiError extends Error {
  constructor(public code: string) { super(MESSAGES[code] ?? (code.startsWith("header:") ? "A mapped column is missing from the sheet." : "Something went wrong. Try again.")); }
}

async function invoke<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    let code = "failed";
    try {
      const ctx = (error as { context?: Response }).context;
      const parsed = ctx ? await ctx.json() : null;
      if (parsed && typeof parsed.error === "string") code = parsed.error;
    } catch { /* keep generic code */ }
    throw new SheetsApiError(code);
  }
  if (data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string") {
    throw new SheetsApiError((data as { error: string }).error);
  }
  return data as T;
}

export const sheetsApi = <T>(action: string, body: Record<string, unknown> = {}) => invoke<T>("google-sheets-api", { action, ...body });

export async function startGoogleConnect(): Promise<void> {
  const { url } = await invoke<{ url: string }>("google-sheets-oauth-start", { return_origin: window.location.origin });
  window.location.assign(url);
}

export const OAUTH_RETURN_MESSAGES: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Google connected" },
  denied: { ok: false, text: "Google access was not granted." },
  scope_denied: { ok: false, text: "Allow access to the files you choose to connect Google Sheets." },
  expired: { ok: false, text: "That connection attempt expired. Try again." },
  account_mismatch: { ok: false, text: "Use the same Google account, or remove your sheets first." },
  no_offline_access: { ok: false, text: "Google didn't allow background access. Try again." },
  not_permitted: { ok: false, text: "Your role can't import from Google Sheets." },
  error: { ok: false, text: "Couldn't connect Google. Try again." },
};
