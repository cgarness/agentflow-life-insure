// email-sync-incremental
//
// Auth model: cron-only. Authenticated via x-cron-secret header matching the
// EMAIL_SYNC_CRON_SECRET edge secret. Pattern matches recording-retention-purge.
//
// What it does (Gmail only for MVP — Microsoft Graph follows in a separate prompt):
//   - Loads every connected Google inbox across all orgs.
//   - Refreshes the access token if needed; on invalid_grant marks the
//     connection needs_reconnect and skips it.
//   - Bootstrap (no cursor): fetches the last 7 days of messages, then stores
//     the current Gmail historyId for the next delta pass.
//   - Delta (cursor present): pulls users.history.list?startHistoryId=…
//     and processes only messageAdded entries.
//   - Inserts each new message into public.contact_emails with idempotent
//     onConflict on (organization_id, provider, external_message_id).
//     Matches the From address (lowercase, trimmed) against leads → clients →
//     recruits in the same organization_id; contact_id is left NULL on miss.
//   - Skips messages whose From is the connection's own mailbox to avoid
//     duplicating outbound rows already inserted by email-send-contact-message.
//   - Advances email_sync_cursors.cursor_value to the latest historyId.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decodeToken, encodeToken, refreshGoogleAccessToken } from "../_shared/google-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const BOOTSTRAP_QUERY = "newer_than:7d";
const BOOTSTRAP_MAX_MESSAGES = 200;
const HISTORY_PAGE_SIZE = 500;

type GmailHeader = { name?: string; value?: string };

type GmailPart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
};

type GmailMessage = {
  id: string;
  threadId?: string;
  historyId?: string;
  internalDate?: string;
  payload?: GmailPart;
  snippet?: string;
};

type Connection = {
  id: string;
  user_id: string;
  organization_id: string;
  provider: string;
  provider_account_email: string;
  access_token_expires_at: string | null;
  access_token_encrypted: string;
  refresh_token_encrypted: string | null;
  status: string;
};

type Cursor = { connection_id: string; cursor_value: string } | null;

type Summary = {
  scanned: number;
  refreshed: number;
  inserted: number;
  skipped_echoes: number;
  bootstrap_runs: number;
  delta_runs: number;
  needs_reconnect: number;
  errors: string[];
};

const decodeBase64Url = (input: string): string => {
  if (!input) return "";
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "===".slice((normalized.length + 3) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return "";
  }
};

const headerValue = (headers: GmailHeader[] | undefined, name: string): string | null => {
  if (!headers) return null;
  const target = name.toLowerCase();
  for (const h of headers) {
    if (h?.name && h.name.toLowerCase() === target) return h.value ?? null;
  }
  return null;
};

const parseAddressList = (raw: string | null): string[] => {
  if (!raw) return [];
  const out: string[] = [];
  for (const segment of raw.split(",")) {
    const match = segment.match(/<([^>]+)>/);
    const candidate = (match ? match[1] : segment).trim().toLowerCase();
    if (candidate && /.+@.+/.test(candidate)) out.push(candidate);
  }
  return out;
};

const firstAddress = (raw: string | null): string | null => {
  const list = parseAddressList(raw);
  return list[0] ?? null;
};

const collectBodies = (
  part: GmailPart | undefined,
  acc: { text: string | null; html: string | null },
): void => {
  if (!part) return;
  const mime = (part.mimeType || "").toLowerCase();
  const data = part.body?.data;

  if (data && mime === "text/plain" && !acc.text) {
    acc.text = decodeBase64Url(data);
  } else if (data && mime === "text/html" && !acc.html) {
    acc.html = decodeBase64Url(data);
  }

  for (const child of part.parts ?? []) collectBodies(child, acc);
};

const extractBodies = (payload: GmailPart | undefined): { text: string | null; html: string | null } => {
  const acc: { text: string | null; html: string | null } = { text: null, html: null };
  collectBodies(payload, acc);
  // Single-part fallback: payload.body.data with whatever mime.
  if (!acc.text && !acc.html && payload?.body?.data) {
    const decoded = decodeBase64Url(payload.body.data);
    const mime = (payload.mimeType || "").toLowerCase();
    if (mime.includes("html")) acc.html = decoded;
    else acc.text = decoded;
  }
  return acc;
};

const gmailFetch = async (path: string, accessToken: string): Promise<Response> => {
  return await fetch(`https://gmail.googleapis.com/gmail/v1${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
};

const matchContactId = async (
  admin: ReturnType<typeof createClient>,
  organizationId: string,
  fromEmail: string,
): Promise<string | null> => {
  const tables: Array<"leads" | "clients" | "recruits"> = ["leads", "clients", "recruits"];
  for (const table of tables) {
    const { data } = await admin
      .from(table)
      .select("id")
      .eq("organization_id", organizationId)
      .ilike("email", fromEmail)
      .limit(1)
      .maybeSingle();
    if (data?.id) return data.id as string;
  }
  return null;
};

const ensureFreshAccessToken = async (
  admin: ReturnType<typeof createClient>,
  connection: Connection,
  clientId: string,
  clientSecret: string,
): Promise<{ accessToken: string; refreshed: boolean }> => {
  const accessToken = decodeToken(connection.access_token_encrypted) ?? "";
  const refreshToken = decodeToken(connection.refresh_token_encrypted) ?? "";
  const expiresAtMs = connection.access_token_expires_at
    ? new Date(connection.access_token_expires_at).getTime()
    : 0;
  const isStale = !accessToken || !expiresAtMs || expiresAtMs <= Date.now() + 60_000;

  if (!isStale) return { accessToken, refreshed: false };
  if (!refreshToken) throw new Error("Missing refresh token for expired Google connection");

  const refreshed = await refreshGoogleAccessToken({ refreshToken, clientId, clientSecret });
  await admin
    .from("user_email_connections")
    .update({
      access_token_encrypted: encodeToken(refreshed.accessToken),
      access_token_expires_at: refreshed.expiresAt,
      status: "connected",
      last_error: null,
    })
    .eq("id", connection.id);
  return { accessToken: refreshed.accessToken, refreshed: true };
};

const collectBootstrapMessageIds = async (
  accessToken: string,
): Promise<{ ids: string[]; latestHistoryId: string | null }> => {
  const ids: string[] = [];
  let pageToken: string | null = null;
  let latestHistoryId: string | null = null;

  do {
    const params = new URLSearchParams({
      q: BOOTSTRAP_QUERY,
      maxResults: String(Math.min(100, BOOTSTRAP_MAX_MESSAGES - ids.length)),
    });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await gmailFetch(`/users/me/messages?${params.toString()}`, accessToken);
    const payload = await res.json();
    if (!res.ok) {
      throw new Error(`Gmail messages.list failed (${res.status}): ${payload?.error?.message || JSON.stringify(payload)}`);
    }
    for (const m of payload.messages ?? []) {
      if (m?.id) ids.push(m.id);
      if (ids.length >= BOOTSTRAP_MAX_MESSAGES) break;
    }
    pageToken = payload.nextPageToken && ids.length < BOOTSTRAP_MAX_MESSAGES ? payload.nextPageToken : null;
  } while (pageToken);

  // Anchor cursor at the current mailbox historyId.
  const profileRes = await gmailFetch("/users/me/profile", accessToken);
  const profile = await profileRes.json();
  if (profileRes.ok && profile?.historyId) latestHistoryId = String(profile.historyId);

  return { ids, latestHistoryId };
};

const collectDeltaMessageIds = async (
  accessToken: string,
  startHistoryId: string,
): Promise<{ ids: string[]; latestHistoryId: string | null; needsBootstrap: boolean }> => {
  const ids = new Set<string>();
  let latestHistoryId: string | null = startHistoryId;
  let pageToken: string | null = null;

  do {
    const params = new URLSearchParams({
      startHistoryId,
      historyTypes: "messageAdded",
      maxResults: String(HISTORY_PAGE_SIZE),
    });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await gmailFetch(`/users/me/history?${params.toString()}`, accessToken);
    const payload = await res.json();
    if (res.status === 404) {
      // historyId too old — caller should fall back to bootstrap.
      return { ids: [], latestHistoryId: null, needsBootstrap: true };
    }
    if (!res.ok) {
      throw new Error(`Gmail history.list failed (${res.status}): ${payload?.error?.message || JSON.stringify(payload)}`);
    }

    if (payload?.historyId) latestHistoryId = String(payload.historyId);

    for (const entry of payload.history ?? []) {
      for (const added of entry.messagesAdded ?? []) {
        const id = added?.message?.id;
        if (id) ids.add(id);
      }
    }
    pageToken = payload.nextPageToken ?? null;
  } while (pageToken);

  return { ids: [...ids], latestHistoryId, needsBootstrap: false };
};

const fetchMessage = async (accessToken: string, messageId: string): Promise<GmailMessage | null> => {
  const res = await gmailFetch(`/users/me/messages/${encodeURIComponent(messageId)}?format=full`, accessToken);
  const payload = await res.json();
  if (!res.ok) {
    // Skip this message but don't kill the batch.
    console.warn(`messages.get ${messageId} failed (${res.status}): ${payload?.error?.message || ""}`);
    return null;
  }
  return payload as GmailMessage;
};

const isInvalidGrant = (err: unknown): boolean => {
  const msg = err instanceof Error ? err.message : String(err);
  return /invalid_grant|invalid grant|Token has been expired or revoked/i.test(msg);
};

const processConnection = async (
  admin: ReturnType<typeof createClient>,
  connection: Connection,
  cursor: Cursor,
  clientId: string,
  clientSecret: string,
  summary: Summary,
): Promise<void> => {
  let accessToken: string;
  try {
    const tokenResult = await ensureFreshAccessToken(admin, connection, clientId, clientSecret);
    accessToken = tokenResult.accessToken;
    if (tokenResult.refreshed) summary.refreshed += 1;
  } catch (err) {
    if (isInvalidGrant(err)) {
      await admin
        .from("user_email_connections")
        .update({
          status: "needs_reconnect",
          last_error: err instanceof Error ? err.message : "Refresh failed",
        })
        .eq("id", connection.id);
      summary.needs_reconnect += 1;
      return;
    }
    throw err;
  }

  let messageIds: string[] = [];
  let latestHistoryId: string | null = null;

  if (cursor?.cursor_value) {
    const delta = await collectDeltaMessageIds(accessToken, cursor.cursor_value);
    if (delta.needsBootstrap) {
      const bootstrap = await collectBootstrapMessageIds(accessToken);
      messageIds = bootstrap.ids;
      latestHistoryId = bootstrap.latestHistoryId;
      summary.bootstrap_runs += 1;
    } else {
      messageIds = delta.ids;
      latestHistoryId = delta.latestHistoryId;
      summary.delta_runs += 1;
    }
  } else {
    const bootstrap = await collectBootstrapMessageIds(accessToken);
    messageIds = bootstrap.ids;
    latestHistoryId = bootstrap.latestHistoryId;
    summary.bootstrap_runs += 1;
  }

  const ownEmail = (connection.provider_account_email || "").toLowerCase().trim();

  for (const messageId of messageIds) {
    const message = await fetchMessage(accessToken, messageId);
    if (!message) continue;

    const headers = message.payload?.headers ?? [];
    const fromRaw = headerValue(headers, "From");
    const from = firstAddress(fromRaw);
    if (!from) continue;

    if (ownEmail && from === ownEmail) {
      summary.skipped_echoes += 1;
      continue;
    }

    const toEmails = parseAddressList(headerValue(headers, "To"));
    const ccEmails = parseAddressList(headerValue(headers, "Cc"));
    const subject = headerValue(headers, "Subject");
    const internetMessageId = headerValue(headers, "Message-ID") || headerValue(headers, "Message-Id");
    const inReplyTo = headerValue(headers, "In-Reply-To");
    const references = headerValue(headers, "References");
    const dateHeader = headerValue(headers, "Date");

    let receivedAt: string;
    if (message.internalDate) {
      receivedAt = new Date(Number(message.internalDate)).toISOString();
    } else if (dateHeader) {
      const parsed = new Date(dateHeader);
      receivedAt = Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
    } else {
      receivedAt = new Date().toISOString();
    }

    const { text: bodyText, html: bodyHtml } = extractBodies(message.payload);
    const contactId = await matchContactId(admin, connection.organization_id, from);

    const { error: insertError } = await admin
      .from("contact_emails")
      .upsert(
        {
          organization_id: connection.organization_id,
          contact_id: contactId,
          owner_user_id: connection.user_id,
          connection_id: connection.id,
          provider: "google",
          direction: "inbound",
          external_message_id: message.id,
          thread_id: message.threadId ?? null,
          internet_message_id: internetMessageId,
          in_reply_to: inReplyTo,
          reference_ids: references,
          from_email: from,
          to_emails: toEmails,
          cc_emails: ccEmails,
          subject,
          body_text: bodyText,
          body_html: bodyHtml,
          received_at: receivedAt,
          delivery_status: "received",
        },
        { onConflict: "organization_id,provider,external_message_id", ignoreDuplicates: true },
      )
      .select("id");

    if (insertError) {
      summary.errors.push(`insert ${message.id}: ${insertError.message}`);
      continue;
    }
    summary.inserted += 1;
  }

  if (latestHistoryId) {
    const { error: cursorError } = await admin
      .from("email_sync_cursors")
      .upsert(
        {
          organization_id: connection.organization_id,
          connection_id: connection.id,
          provider: "google",
          cursor_value: latestHistoryId,
          cursor_updated_at: new Date().toISOString(),
        },
        { onConflict: "connection_id" },
      );
    if (cursorError) summary.errors.push(`cursor ${connection.id}: ${cursorError.message}`);
  }

  await admin
    .from("user_email_connections")
    .update({ last_sync_at: new Date().toISOString(), last_error: null })
    .eq("id", connection.id);
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  const requiredCronSecret = Deno.env.get("EMAIL_SYNC_CRON_SECRET");
  const cronSecret = req.headers.get("x-cron-secret") ?? "";
  if (!requiredCronSecret || cronSecret !== requiredCronSecret) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ success: false, error: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured" }, 500);
  }
  if (!googleClientId || !googleClientSecret) {
    return json({ success: false, error: "GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not configured" }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const summary: Summary = {
    scanned: 0,
    refreshed: 0,
    inserted: 0,
    skipped_echoes: 0,
    bootstrap_runs: 0,
    delta_runs: 0,
    needs_reconnect: 0,
    errors: [],
  };

  try {
    const { data: connections, error: connectionsError } = await admin
      .from("user_email_connections")
      .select(
        "id, user_id, organization_id, provider, provider_account_email, access_token_encrypted, refresh_token_encrypted, access_token_expires_at, status",
      )
      .eq("provider", "google")
      .eq("status", "connected")
      .limit(500);

    if (connectionsError) return json({ success: false, error: connectionsError.message }, 500);
    summary.scanned = connections?.length ?? 0;
    if (!connections || connections.length === 0) {
      return json({ success: true, ...summary, note: "No connected Google inboxes." });
    }

    const connectionIds = connections.map((c) => c.id);
    const { data: cursorRows, error: cursorError } = await admin
      .from("email_sync_cursors")
      .select("connection_id, cursor_value")
      .in("connection_id", connectionIds);
    if (cursorError) return json({ success: false, error: cursorError.message }, 500);

    const cursorByConnection = new Map<string, string>();
    for (const row of cursorRows ?? []) {
      if (row.connection_id && row.cursor_value) cursorByConnection.set(row.connection_id, row.cursor_value);
    }

    for (const connection of connections as Connection[]) {
      try {
        const cursorValue = cursorByConnection.get(connection.id);
        const cursor: Cursor = cursorValue
          ? { connection_id: connection.id, cursor_value: cursorValue }
          : null;
        await processConnection(admin, connection, cursor, googleClientId, googleClientSecret, summary);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        summary.errors.push(`connection=${connection.id}: ${message}`);
        await admin
          .from("user_email_connections")
          .update({ last_error: message })
          .eq("id", connection.id);
      }
    }

    const status = summary.errors.length > 0 ? 207 : 200;
    return json({ success: summary.errors.length === 0, ...summary }, status);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return json({ success: false, error: message, summary }, 500);
  }
});
