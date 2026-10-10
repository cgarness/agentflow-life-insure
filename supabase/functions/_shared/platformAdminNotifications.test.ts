// Unit tests for platform-admin registration notifications.
// Offline: the Supabase store and Resend are replaced with in-memory fakes.
// Run: deno test --allow-env --allow-read supabase/functions/_shared/platformAdminNotifications.test.ts
//      supabase/functions/platform-admin-notify/index.test.ts

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import {
  AgencyNotificationData,
  CompleteOutcome,
  createResendMailer,
  DEFAULT_PLATFORM_ADMIN_RECIPIENT,
  formatPacific,
  formatUtc,
  isAuthorizedWorkerRequest,
  MailMessage,
  MailResult,
  NotificationStore,
  processQueue,
  QueueRow,
  renderAgencyNotification,
  renderUserNotification,
  resolvePlatformAdminRecipient,
  sanitizeError,
  signupSourceLabel,
  UserNotificationData,
} from "./platformAdminNotifications.ts";
import {
  ADMIN_AGENCY_CREATED_SUBJECT,
  ADMIN_USER_REGISTERED_SUBJECT,
  deriveAgencyStatus,
} from "./systemEmailTemplates.ts";
import { SYSTEM_EMAIL_FROM } from "./systemEmail.ts";

const USER: UserNotificationData = {
  id: "11111111-1111-4111-8111-111111111111",
  firstName: "Ina",
  lastName: "Invitee",
  email: "ina@example.test",
  role: "Agent",
  status: "Active",
  createdAt: "2026-10-10T18:37:48.123Z",
  organizationId: "22222222-2222-4222-8222-222222222222",
  organizationName: "Garness Agency",
  organizationStatus: "active",
  organizationTwilioStatus: "active",
  emailConfirmed: false,
  signupSource: "invite",
  invitedBy: "Chris Admin (chris@example.test)",
};

const AGENCY: AgencyNotificationData = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Fay Agency",
  slug: "fay-agency-1a2b3c4d",
  status: "active",
  twilioSubaccountStatus: "pending",
  createdAt: "2026-10-10T18:37:48.123Z",
  founder: { name: "Fay Founder", email: "fay@example.test", role: "Admin" },
  memberCount: 1,
};

// ── Recipient / auth ──────────────────────────────────────────────────────────

Deno.test("recipient: unset defaults to chris@fflagent.com", () => {
  assertEquals(DEFAULT_PLATFORM_ADMIN_RECIPIENT, "chris@fflagent.com");
  assertEquals(resolvePlatformAdminRecipient(undefined), {
    ok: true,
    recipient: "chris@fflagent.com",
    source: "default",
  });
});

Deno.test("recipient: one valid configured address is used (trimmed)", () => {
  assertEquals(resolvePlatformAdminRecipient("  ops@fflagent.com "), {
    ok: true,
    recipient: "ops@fflagent.com",
    source: "configured",
  });
});

Deno.test("recipient: set-but-invalid fails closed and never echoes the value", () => {
  const bad = [
    "",
    "   ",
    "not-an-email",
    "ops@fflagent",
    "a@b.com, c@d.com",
    "a@b.com;c@d.com",
    "a@b.com c@d.com",
    "a@b.com\r\nBcc: x@y.com",
    "<a@b.com>",
    "Chris <chris@fflagent.com>",
    `${"a".repeat(250)}@b.com`,
  ];
  for (const value of bad) {
    const r = resolvePlatformAdminRecipient(value);
    assertEquals(r.ok, false, JSON.stringify(value));
    if (!r.ok) {
      assertStringIncludes(r.error, "PLATFORM_ADMIN_NOTIFY_RECIPIENT is set but invalid");
      assertStringIncludes(r.error, `length ${value.length}`);
      if (value.trim()) assert(!r.error.includes(value.trim()), "configured value must not be echoed");
      assert(!r.error.includes("@"), "no address fragment in the error");
      assert(!r.error.includes(DEFAULT_PLATFORM_ADMIN_RECIPIENT), "must not fall back to the default");
    }
  }
});

Deno.test("worker auth requires an exact Bearer match on a >= 32 char token", () => {
  const token = "x".repeat(40);
  assert(isAuthorizedWorkerRequest(`Bearer ${token}`, token));
  assert(!isAuthorizedWorkerRequest(`Bearer ${token}y`, token));
  assert(!isAuthorizedWorkerRequest(token, token));
  assert(!isAuthorizedWorkerRequest(null, token));
  assert(!isAuthorizedWorkerRequest("Bearer short", "short"), "short tokens are never accepted");
  assert(!isAuthorizedWorkerRequest("Bearer ", ""), "unset token rejects everything");
  assert(!isAuthorizedWorkerRequest("Bearer undefined", undefined));
});

// ── Formatting / status ─────────────────────────────────────────────────────

Deno.test("timestamps render in UTC and Pacific", () => {
  assertEquals(formatUtc("2026-10-10T18:37:48.123Z"), "2026-10-10 18:37:48 UTC");
  assertStringIncludes(formatPacific("2026-10-10T18:37:48.123Z"), "11:37:48");
  assertStringIncludes(formatPacific("2026-10-10T18:37:48.123Z"), "PDT");
  assertStringIncludes(formatPacific("2026-12-10T18:37:48.123Z"), "PST");
  assertEquals(formatUtc(null), "Unknown");
  assertEquals(formatPacific("garbage"), "Unknown");
});

Deno.test("signup source labels", () => {
  assertEquals(signupSourceLabel("invite"), "Team invitation");
  assertEquals(signupSourceLabel("self_serve"), "Self-service signup");
  assertEquals(signupSourceLabel(undefined), "Other (administrative or direct)");
});

Deno.test("agency status distinguishes Active, Pending, Suspended and Archived", () => {
  assertEquals(deriveAgencyStatus("active", "active").label, "Active");
  assertEquals(deriveAgencyStatus("active", "active").tone, "success");
  assertEquals(deriveAgencyStatus("active", "pending").label, "Pending");
  assertEquals(deriveAgencyStatus("active", "pending").tone, "warning");
  assertStringIncludes(deriveAgencyStatus("active", "pending_manual").detail, "manual");
  assertEquals(deriveAgencyStatus(null, "pending").label, "Pending", "NULL status = column default 'active'");
  assertEquals(deriveAgencyStatus(null, "active").label, "Active");
  assertEquals(deriveAgencyStatus("suspended", "active").label, "Suspended");
  assertEquals(deriveAgencyStatus("suspended", "active").tone, "danger");
  assertEquals(deriveAgencyStatus("archived", "closed").label, "Archived");
  assertEquals(deriveAgencyStatus("active", "closed").label, "Pending");
  assertEquals(deriveAgencyStatus("weird", "active").label, "Pending");
});

Deno.test("sanitizeError strips control characters and bounds length", () => {
  const out = sanitizeError(new Error("line1\r\nline2\t" + "z".repeat(400)));
  assert(!/[\r\n\t]/.test(out));
  assert(out.length <= 300);
  assertEquals(sanitizeError(""), "Unknown error");
});

// ── Rendering ─────────────────────────────────────────────────────────────────

Deno.test("user email: subject, ADMIN ONLY marker, details and statuses", () => {
  const r = renderUserNotification(USER);
  assertEquals(r.subject, ADMIN_USER_REGISTERED_SUBJECT);
  assertEquals(r.subject, "[AGENTFLOW ADMIN] New User Registered");
  for (const body of [r.html, r.text]) {
    assertStringIncludes(body, "ADMIN ONLY");
    assertStringIncludes(body, "Ina Invitee");
    assertStringIncludes(body, "ina@example.test");
    assertStringIncludes(body, "Garness Agency");
    assertStringIncludes(body, "Team invitation");
    assertStringIncludes(body, "Chris Admin (chris@example.test)");
    assertStringIncludes(body, "Pending"); // email not confirmed
    assertStringIncludes(body, "2026-10-10 18:37:48 UTC");
    assertStringIncludes(body, USER.id);
  }
  assertStringIncludes(r.html, "Admin Only · Internal Notification");
  assertStringIncludes(r.html, `/super-admin/organizations/${USER.organizationId}`);
});

Deno.test("user email without an organization links to /super-admin", () => {
  const r = renderUserNotification({ ...USER, organizationId: null, organizationName: null, signupSource: "self_serve" });
  assertStringIncludes(r.text, "No agency yet");
  assertStringIncludes(r.text, "Self-service signup");
  assert(!r.text.includes("Agency status:"));
  assertStringIncludes(r.html, 'href="https://www.fflagent.com/super-admin"');
});

Deno.test("user email shows the agency lifecycle for suspended orgs", () => {
  const r = renderUserNotification({ ...USER, organizationStatus: "suspended" });
  assertStringIncludes(r.text, "Agency status: Suspended");
});

Deno.test("agency email: subject, status, founder, members", () => {
  const r = renderAgencyNotification(AGENCY);
  assertEquals(r.subject, ADMIN_AGENCY_CREATED_SUBJECT);
  assertEquals(r.subject, "[AGENTFLOW ADMIN] New Agency Created");
  for (const body of [r.html, r.text]) {
    assertStringIncludes(body, "ADMIN ONLY");
    assertStringIncludes(body, "Fay Agency");
    assertStringIncludes(body, "Pending");
    assertStringIncludes(body, "Phone system provisioning is pending.");
    assertStringIncludes(body, "Fay Founder (fay@example.test) — Admin");
    assertStringIncludes(body, AGENCY.id);
  }
  assertStringIncludes(r.text, "Members: 1");
  assertStringIncludes(renderAgencyNotification({ ...AGENCY, status: "suspended" }).text, "Status: Suspended");
  assertStringIncludes(
    renderAgencyNotification({ ...AGENCY, twilioSubaccountStatus: "active" }).text,
    "Status: Active",
  );
  assertStringIncludes(renderAgencyNotification({ ...AGENCY, founder: null, memberCount: 0 }).text, "No member attached yet");
});

Deno.test("attacker-influenced values are escaped in HTML and single-line in text", () => {
  const evil = '<script>alert(1)</script>"\'&';
  const r = renderUserNotification({ ...USER, firstName: evil, lastName: "\r\nBcc: x@y.com", organizationName: evil });
  assert(!r.html.includes("<script>"), "raw script tag must not appear");
  assertStringIncludes(r.html, "&lt;script&gt;");
  assert(!r.text.includes("\r\nBcc:"), "no injected text lines");
  const a = renderAgencyNotification({ ...AGENCY, name: evil, slug: evil });
  assert(!a.html.includes("<script>"));
});

Deno.test("no secret-shaped fields reach the email", () => {
  const r = renderUserNotification(USER);
  for (const forbidden of ["password", "token", "app_metadata", "access_token", "verify", "action_link"]) {
    assert(!r.text.toLowerCase().includes(forbidden), `text contains ${forbidden}`);
  }
});

// ── Queue processing (fake store + fake mailer) ───────────────────────────────

type Completion = { id: string; outcome: CompleteOutcome; providerId: string | null; error: string | null };

function fakeStore(rows: QueueRow[], opts: {
  users?: Record<string, UserNotificationData | null>;
  agencies?: Record<string, AgencyNotificationData | null>;
  loadThrows?: boolean;
  completeThrows?: boolean;
} = {}) {
  const completions: Completion[] = [];
  const store: NotificationStore = {
    claim: (limit) => Promise.resolve(rows.slice(0, limit)),
    complete: (id, outcome, providerId = null, error = null) => {
      if (opts.completeThrows) return Promise.reject(new Error("db down"));
      completions.push({ id, outcome, providerId, error });
      const status = outcome === "retry" ? "pending" : outcome;
      return Promise.resolve(status);
    },
    loadUser: (id) => opts.loadThrows ? Promise.reject(new Error("lookup failed")) : Promise.resolve(opts.users?.[id] ?? null),
    loadAgency: (id) => opts.loadThrows ? Promise.reject(new Error("lookup failed")) : Promise.resolve(opts.agencies?.[id] ?? null),
  };
  return { store, completions };
}

function fakeMailer(result: MailResult) {
  const sent: MailMessage[] = [];
  const mailer = (m: MailMessage) => {
    sent.push(m);
    return Promise.resolve(result);
  };
  return { mailer, sent };
}

const USER_ROW: QueueRow = { id: "row-user-1", event_type: "user_registered", subject_id: USER.id, organization_id: USER.organizationId, attempts: 1 };
const AGENCY_ROW: QueueRow = { id: "row-agency-1", event_type: "agency_created", subject_id: AGENCY.id, organization_id: AGENCY.id, attempts: 1 };

Deno.test("delivers both events to the configured recipient with stable idempotency keys", async () => {
  const { store, completions } = fakeStore([USER_ROW, AGENCY_ROW], {
    users: { [USER.id]: USER },
    agencies: { [AGENCY.id]: AGENCY },
  });
  const { mailer, sent } = fakeMailer({ ok: true, id: "resend-1" });
  const summary = await processQueue(store, mailer, "chris@fflagent.com");
  assertEquals(summary, { claimed: 2, sent: 2, skipped: 0, retried: 0, failed: 0, errors: 0 });
  assertEquals(sent.map((m) => m.to), ["chris@fflagent.com", "chris@fflagent.com"]);
  assertEquals(sent.map((m) => m.subject), [ADMIN_USER_REGISTERED_SUBJECT, ADMIN_AGENCY_CREATED_SUBJECT]);
  assertEquals(sent.map((m) => m.idempotencyKey), ["platform-admin-row-user-1", "platform-admin-row-agency-1"]);
  assertEquals(completions.map((c) => [c.outcome, c.providerId]), [["sent", "resend-1"], ["sent", "resend-1"]]);
});

Deno.test("a deleted subject is skipped without sending", async () => {
  const { store, completions } = fakeStore([USER_ROW, AGENCY_ROW]);
  const { mailer, sent } = fakeMailer({ ok: true, id: "x" });
  const summary = await processQueue(store, mailer, "chris@fflagent.com");
  assertEquals(sent.length, 0);
  assertEquals(summary.skipped, 2);
  assertEquals(completions.map((c) => [c.outcome, c.error]), [["skipped", "subject_deleted"], ["skipped", "subject_deleted"]]);
});

Deno.test("a retryable provider failure is recorded as retry", async () => {
  const { store, completions } = fakeStore([USER_ROW], { users: { [USER.id]: USER } });
  const { mailer } = fakeMailer({ ok: false, retryable: true, error: "Resend HTTP 500" });
  const summary = await processQueue(store, mailer, "chris@fflagent.com");
  assertEquals(summary.retried, 1);
  assertEquals(completions[0].outcome, "retry");
  assertEquals(completions[0].error, "Resend HTTP 500");
});

Deno.test("a non-retryable provider failure closes the row", async () => {
  const { store, completions } = fakeStore([USER_ROW], { users: { [USER.id]: USER } });
  const { mailer } = fakeMailer({ ok: false, retryable: false, error: "Resend HTTP 409 invalid_idempotent_request" });
  const summary = await processQueue(store, mailer, "chris@fflagent.com");
  assertEquals(summary.failed, 1);
  assertEquals(completions[0].outcome, "failed");
});

Deno.test("a lookup exception becomes a retry, never a thrown run", async () => {
  const { store, completions } = fakeStore([USER_ROW, AGENCY_ROW], { loadThrows: true });
  const { mailer, sent } = fakeMailer({ ok: true, id: "x" });
  const summary = await processQueue(store, mailer, "chris@fflagent.com");
  assertEquals(sent.length, 0);
  assertEquals(summary.retried, 2);
  assertEquals(completions.map((c) => c.error), ["lookup failed", "lookup failed"]);
});

Deno.test("a failed bookkeeping call is counted, not thrown", async () => {
  const { store } = fakeStore([USER_ROW], { users: { [USER.id]: USER }, completeThrows: true });
  const { mailer } = fakeMailer({ ok: true, id: "x" });
  const summary = await processQueue(store, mailer, "chris@fflagent.com");
  assertEquals(summary.errors, 1);
  assertEquals(summary.sent, 0);
});

Deno.test("an empty queue sends nothing", async () => {
  const { store } = fakeStore([]);
  const { mailer, sent } = fakeMailer({ ok: true, id: "x" });
  const summary = await processQueue(store, mailer, "chris@fflagent.com");
  assertEquals(summary.claimed, 0);
  assertEquals(sent.length, 0);
});

// ── Resend mailer (fake fetch) ────────────────────────────────────────────────

function fakeFetch(status: number, body: unknown, capture?: { req?: Request; init?: RequestInit }) {
  return ((input: string | URL | Request, init?: RequestInit) => {
    if (capture) {
      capture.init = init;
    }
    void input;
    return Promise.resolve(new Response(body === undefined ? "not json" : JSON.stringify(body), { status }));
  }) as typeof fetch;
}

const MESSAGE: MailMessage = {
  to: "chris@fflagent.com",
  subject: ADMIN_USER_REGISTERED_SUBJECT,
  html: "<p>x</p>",
  text: "x",
  idempotencyKey: "platform-admin-row-1",
};

Deno.test("Resend request uses the verified sender, recipient and idempotency key", async () => {
  const capture: { init?: RequestInit } = {};
  const result = await createResendMailer("re_test", fakeFetch(200, { id: "msg_123" }, capture))(MESSAGE);
  assertEquals(result, { ok: true, id: "msg_123" });
  const headers = capture.init?.headers as Record<string, string>;
  assertEquals(headers["Idempotency-Key"], "platform-admin-row-1");
  assertEquals(headers.Authorization, "Bearer re_test");
  const payload = JSON.parse(String(capture.init?.body));
  assertEquals(payload.from, SYSTEM_EMAIL_FROM);
  assertEquals(payload.to, ["chris@fflagent.com"]);
  assertEquals(payload.subject, ADMIN_USER_REGISTERED_SUBJECT);
});

Deno.test("Resend 5xx and network errors are retryable; idempotency mismatch is not", async () => {
  assertEquals(await createResendMailer("k", fakeFetch(500, { name: "internal_server_error" }))(MESSAGE), {
    ok: false,
    retryable: true,
    error: "Resend HTTP 500 internal_server_error",
  });
  const mismatch = await createResendMailer("k", fakeFetch(409, { name: "invalid_idempotent_request" }))(MESSAGE);
  assertEquals(mismatch.ok, false);
  if (!mismatch.ok) assertEquals(mismatch.retryable, false);
  const concurrent = await createResendMailer("k", fakeFetch(409, { name: "concurrent_idempotent_requests" }))(MESSAGE);
  if (!concurrent.ok) assertEquals(concurrent.retryable, true);
  const network = await createResendMailer("k", (() => Promise.reject(new TypeError("dns failure"))) as typeof fetch)(MESSAGE);
  assertEquals(network.ok, false);
  if (!network.ok) {
    assertEquals(network.retryable, true);
    assertStringIncludes(network.error, "dns failure");
  }
  const nonJson = await createResendMailer("k", fakeFetch(502, undefined))(MESSAGE);
  if (!nonJson.ok) assertEquals(nonJson.error, "Resend HTTP 502");
});
