import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeToken, tokenContext } from "./google-token";

const uid = "11111111-1111-1111-1111-111111111111";
const cid = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const org = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const generation = "99999999-9999-9999-9999-999999999999";
const vars: Record<string, string> = {
  SUPABASE_URL: "https://database.example.test", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service",
  SUPABASE_ANON_KEY: "synthetic-anon", EMAIL_SYNC_CRON_SECRET: "synthetic-cron",
  GOOGLE_CLIENT_ID: "synthetic-client", GOOGLE_CLIENT_SECRET: "synthetic-secret",
  GOOGLE_TOKEN_KEYS: JSON.stringify({ primary: Buffer.alloc(32, 7).toString("base64") }),
};
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
let handler: (req: Request) => Promise<Response>;
let calls: Array<{ url: URL; method: string; body: Record<string, unknown>; headers: Headers }>;
let row: Record<string, unknown>;
let mode: "send" | "sync" | "calendar";
let providerStatus: number;
let refreshError: string | undefined;
let stale: boolean;
let messageFails: boolean;
let duplicate: boolean;
let deletionDuringSend: boolean;
let staleAfterRefresh: boolean;
const request = (body: unknown = {}) => new Request("https://edge.example.test/endpoint", { method: "POST", headers: { Authorization: "Bearer synthetic-user", "x-cron-secret": vars.EMAIL_SYNC_CRON_SECRET, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const sendBody = { contact_id: "contact", contact_type: "lead", to_email: "recipient@example.test", subject: "Unicode résumé", body_text: "Synthetic test only" };
async function load(kind: typeof mode) {
  mode = kind;
  if (kind === "send") await import("../email-send-contact-message/index.ts");
  if (kind === "sync") await import("../email-sync-incremental/index.ts");
  if (kind === "calendar") await import("../google-calendar-list/index.ts");
}
beforeEach(async () => {
  vi.resetModules(); calls = []; providerStatus = 200; refreshError = undefined; stale = false; messageFails = false; duplicate = false; deletionDuringSend = false; staleAfterRefresh = false;
  vi.stubGlobal("Deno", { env: { get: (k: string) => vars[k] }, serve: (fn: typeof handler) => { handler = fn; } });
  row = { id: cid, user_id: uid, organization_id: org, connection_generation: generation, provider: "google", provider_account_email: "owner@example.test", status: "connected", sync_enabled: true,
    access_token_encrypted: await encodeToken("access", tokenContext("email", uid, "access")), refresh_token_encrypted: await encodeToken("refresh", tokenContext("email", uid, "refresh")), access_token_expires_at: new Date(Date.now() + 3600000).toISOString(),
    access_token: await encodeToken("calendar-access", tokenContext("calendar", uid, "access")), refresh_token: await encodeToken("calendar-refresh", tokenContext("calendar", uid, "refresh")), token_expires_at: new Date(Date.now() + 3600000).toISOString() };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input)); const method = init?.method || "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    calls.push({ url, method, body, headers: new Headers(init?.headers) });
    if (url.pathname === "/auth/v1/user") return reply({ id: uid, email: "owner@example.test" });
    if (url.pathname === "/rest/v1/profiles") return reply({ id: uid, organization_id: org });
    if (/\/rest\/v1\/(leads|clients|recruits)$/.test(url.pathname)) return url.searchParams.has("id") ? reply({ organization_id: org }) : reply(null);
    if (url.pathname === "/rest/v1/user_email_connections") {
      if (method === "PATCH") return url.searchParams.has("select") ? reply(stale || staleAfterRefresh ? null : { id: cid }) : new Response(null, { status: 204 });
      if (mode === "sync") return reply([row]);
      return url.searchParams.get("select") === "id" ? reply(stale ? null : { id: cid }) : reply(row);
    }
    if (url.pathname === "/rest/v1/calendar_integrations") return method === "PATCH" ? reply(stale ? null : { id: cid }) : reply(row);
    if (url.pathname === "/rest/v1/email_sync_cursors") return reply([]);
    if (url.pathname === "/rest/v1/rpc/check_google_mailbox") return stale ? reply({message:"connection_changed"},409) : reply(true);
    if (url.pathname === "/rest/v1/rpc/persist_google_outbound_email") return deletionDuringSend || stale ? reply({message:"connection_changed"},409) : reply("message-row");
    if (url.pathname === "/rest/v1/rpc/persist_google_email_message") return reply(duplicate ? null : "message-row");
    if (url.pathname === "/rest/v1/rpc/advance_google_email_cursor") return reply(null);
    if (["/rest/v1/contact_emails", "/rest/v1/activity_logs"].includes(url.pathname)) return new Response(null, { status: 201 });
    if (url.hostname === "oauth2.googleapis.com") return refreshError ? reply({ error: refreshError }, refreshError === "invalid_grant" ? 400 : 503) : reply({ access_token: "refreshed-access", expires_in: 3600 });
    if (url.pathname.endsWith("/messages/send")) return providerStatus === 200 ? reply({ id: "gmail-id", threadId: "thread" }) : reply({ error: { code: providerStatus, message: "Temporary quota issue", errors: [{ reason: "rateLimitExceeded" }] } }, providerStatus);
    if (url.pathname.endsWith("/profile")) return providerStatus === 200 ? reply({ historyId: "anchor-before-list" }) : reply({ error: { message: "Google access changed" } }, providerStatus);
    if (url.pathname.endsWith("/messages")) return reply({ messages: [{ id: "message-1" }] });
    if (url.pathname.endsWith("/messages/message-1")) return messageFails ? reply({ error: "Temporary failure" }, 503) : reply({ id: "message-1", threadId: "thread", internalDate: "1700000000000", payload: { mimeType: "text/plain", headers: [{ name: "From", value: "sender@example.test" }, { name: "To", value: "owner@example.test" }, { name: "Subject", value: "Inbound test" }], body: { data: btoa("Synthetic body") } } });
    if (url.pathname.endsWith("/calendarList")) return providerStatus === 200 ? reply({ items: [{ id: "primary", summary: "Test calendar" }] }) : reply({ error: { message: "Google access changed" } }, providerStatus);
    throw new Error(`Unexpected mocked request ${url.pathname}`);
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("Gmail send consumer", () => {
  it("does not resend or retain history when deletion wins after Google accepts the send", async () => {
    deletionDuringSend = true; await load("send"); const res = await handler(request(sendBody));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({success:true,history_saved:false});
    expect(calls.filter(c => c.url.pathname.endsWith("/messages/send"))).toHaveLength(1);
    expect(calls.some(c => c.url.pathname === "/rest/v1/contact_emails")).toBe(false);
  });
  it("does not dispatch a send when the mailbox preflight rejects pending deletion", async () => {
    stale=true; await load("send"); await handler(request(sendBody));
    expect(calls.some(c => c.url.pathname.endsWith("/messages/send"))).toBe(false);
  });
  it("decrypts credentials only on the server and preserves a Unicode subject", async () => {
    await load("send"); const res = await handler(request(sendBody));
    expect((await res.json()).success).toBe(true);
    const send = calls.find(c => c.url.pathname.endsWith("/messages/send"))!;
    expect(send.headers.get("Authorization")).toBe("Bearer access");
    const mime = Buffer.from(String(send.body.raw), "base64url").toString();
    expect(mime).toContain(`Subject: =?UTF-8?B?${Buffer.from(sendBody.subject).toString("base64")}?=`);
    const persisted = calls.find(c => c.url.pathname.endsWith("persist_google_outbound_email"));
    expect(persisted?.body.p_generation).toBe(generation);
    expect(persisted?.body.p_connection).toBe(cid);
    expect(calls.some(c => ["/rest/v1/contact_emails","/rest/v1/activity_logs"].includes(c.url.pathname))).toBe(false);
  });
  it("does not label a quota failure as revoked access or a successful send", async () => {
    providerStatus = 403; await load("send"); const res = await handler(request(sendBody));
    expect(res.status).toBe(502); expect((await res.json()).success).toBe(false);
    expect(calls.some(c => c.body.status === "needs_reconnect")).toBe(false);
  });
  it("marks a revoked refresh grant for reconnect without sending", async () => {
    row.access_token_expires_at = "2000-01-01"; refreshError = "invalid_grant";
    await load("send"); await handler(request(sendBody));
    expect(calls.some(c => c.body.status === "needs_reconnect")).toBe(true);
    expect(calls.some(c => c.url.pathname.endsWith("/messages/send"))).toBe(false);
  });
  it("does not send after an in-flight refresh loses its generation guard", async () => {
    row.access_token_expires_at = "2000-01-01"; staleAfterRefresh = true;
    await load("send"); expect((await handler(request(sendBody))).status).toBe(502);
    expect(calls.some(c => c.url.pathname.endsWith("/messages/send"))).toBe(false);
    const patch = calls.find(c => c.body.access_token_encrypted)!;
    expect(patch.url.searchParams.get("connection_generation")).toBe(`eq.${generation}`);
    expect(String(patch.body.access_token_encrypted)).toMatch(/^gct\.v1\./);
  });
});

describe("Gmail synchronization consumer", () => {
  it("does not retrieve a mailbox after the lifecycle preflight rejects it", async () => {
    stale=true; await load("sync"); expect((await handler(request())).status).toBe(207);
    expect(calls.some(c => c.url.hostname === "gmail.googleapis.com")).toBe(false);
  });
  it("marks a rejected access token for reconnect even before expiry", async () => {
    providerStatus = 401; await load("sync"); const body = await (await handler(request())).json();
    expect(body.needs_reconnect).toBe(1);
    expect(calls.some(c => c.body.status === "needs_reconnect")).toBe(true);
    expect(calls.some(c => c.url.pathname.endsWith("advance_google_email_cursor"))).toBe(false);
  });
  it("persists before advancing the pre-list anchor cursor", async () => {
    await load("sync"); const body = await (await handler(request())).json();
    expect(body.inserted).toBe(1);
    const paths = calls.map(c => c.url.pathname);
    expect(paths.indexOf("/gmail/v1/users/me/profile")).toBeLessThan(paths.indexOf("/gmail/v1/users/me/messages"));
    expect(paths.indexOf("/rest/v1/rpc/persist_google_email_message")).toBeLessThan(paths.indexOf("/rest/v1/rpc/advance_google_email_cursor"));
    expect(calls.find(c => c.url.pathname.endsWith("advance_google_email_cursor"))?.body.p_cursor).toBe("anchor-before-list");
  });
  it("never advances the cursor past a message retrieval failure", async () => {
    messageFails = true; await load("sync"); const res = await handler(request());
    expect(res.status).toBe(207);
    expect(calls.some(c => c.url.pathname.endsWith("advance_google_email_cursor"))).toBe(false);
  });
  it("does not duplicate notifications or insertion counts on replay", async () => {
    duplicate = true; await load("sync"); const body = await (await handler(request())).json();
    expect(body.inserted).toBe(0); expect(body.success).toBe(true);
    expect(calls.some(c => c.url.pathname.endsWith("/notifications"))).toBe(false);
  });
  it("keeps a connection usable after a transient refresh outage", async () => {
    row.access_token_expires_at = "2000-01-01"; refreshError = "temporarily_unavailable";
    await load("sync"); expect((await handler(request())).status).toBe(207);
    expect(calls.some(c => c.body.status === "needs_reconnect")).toBe(false);
    expect(calls.some(c => c.url.pathname.endsWith("advance_google_email_cursor"))).toBe(false);
  });
});

describe("Calendar credential compatibility", () => {
  it("stops claiming connection when Google rejects an unexpired access token", async () => {
    providerStatus = 401; await load("calendar"); expect((await handler(request())).status).toBe(400);
    expect(calls.some(c => c.body.sync_enabled === false)).toBe(true);
  });
  it("reads encrypted credentials through owner- and organization-scoped server access", async () => {
    await load("calendar"); const body = await (await handler(request())).json();
    expect(body).toEqual({ calendars: [{ id: "primary", summary: "Test calendar" }] });
    const read = calls.find(c => c.url.pathname.endsWith("/calendar_integrations"))!;
    expect(read.url.searchParams.get("user_id")).toBe(`eq.${uid}`);
    expect(read.url.searchParams.get("organization_id")).toBe(`eq.${org}`);
    expect(read.headers.get("apikey")).toBe("synthetic-service");
    expect(calls.find(c => c.url.pathname.endsWith("/calendarList"))?.headers.get("Authorization")).toBe("Bearer calendar-access");
  });
  it("disables a revoked Calendar grant without changing Gmail", async () => {
    row.token_expires_at = "2000-01-01"; refreshError = "invalid_grant";
    await load("calendar"); expect((await handler(request())).status).toBe(400);
    expect(calls.some(c => c.body.sync_enabled === false && c.body.access_token === null)).toBe(true);
    expect(calls.some(c => c.url.pathname.endsWith("/user_email_connections"))).toBe(false);
  });
});
