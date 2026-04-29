// Shared Google OAuth token helpers for edge functions.
// Used by google-calendar-inbound-sync, email-connect-callback,
// email-send-contact-message, and (future) email-sync-incremental.
//
// Storage envelope: tokens are base64-encoded with btoa() before insert and
// decoded with atob() on read. This is NOT real encryption — the column suffix
// `_encrypted` on `calendar_integrations` and `user_email_connections` is a
// placeholder for a future Vault/pgsodium pass that will swap both tables in a
// single migration.

export type GoogleRefreshResult = {
  accessToken: string;
  expiresIn: number;
  expiresAt: string;
};

export async function refreshGoogleAccessToken(params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<GoogleRefreshResult> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      grant_type: "refresh_token",
      refresh_token: params.refreshToken,
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error_description ?? payload?.error ?? "Failed to refresh Google token");
  }
  if (!payload?.access_token || !payload?.expires_in) {
    throw new Error("Google refresh response is missing access_token or expires_in");
  }

  const expiresIn = Number(payload.expires_in);
  return {
    accessToken: payload.access_token as string,
    expiresIn,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}

export function encodeToken(plain: string | null | undefined): string | null {
  if (!plain) return null;
  const bytes = new TextEncoder().encode(plain);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

// TODO(2026-05-06): remove the raw-string fallback once all live token rows
// have been overwritten by a refresh cycle. Tracking: email module audit
// migration 20260429190000_email_module_audit.sql.
export function decodeToken(stored: string | null | undefined): string | null {
  if (!stored) return null;
  try {
    const decoded = atob(stored);
    // OAuth tokens are printable ASCII. If decoded contains a non-printable
    // byte, treat the input as already-raw (Codex-era email rows).
    if (/^[\x20-\x7E]+$/.test(decoded)) return decoded;
  } catch {
    // not valid base64 — fall through to raw
  }
  return stored;
}
