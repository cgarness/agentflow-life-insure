// Run: deno test --allow-read --allow-env supabase/functions/_shared/onboardingEmail/
import assert from "node:assert/strict";
import {
  buildUnsubscribeUrls,
  type ClaimedDelivery,
  type CompleteOutcome,
  createResendMailer,
  isAuthorizedWorkerRequest,
  isSendingEnabled,
  type MailMessage,
  type MailResult,
  type OnboardingStore,
  processQueue,
  sanitizeError,
} from "./delivery.ts";
import type { DeliveryContext } from "./eligibility.ts";
import { verifyUnsubscribeToken } from "./unsubscribeToken.ts";

const SECRET = "u".repeat(40);
const NOW = new Date("2026-10-12T15:00:00Z");
const ORG = "00000000-0000-0000-0000-0000000000a1";
const USER = "00000000-0000-0000-0000-000000000101";

function context(id: string, overrides: Partial<DeliveryContext> = {}): DeliveryContext {
  return {
    delivery_id: id, delivery_status: "sending", step_key: "agent_day01_dialer_ready", template_version: 1,
    sequence_key: "agent", expires_at: "2026-10-14T15:00:00Z", enrollment_status: "active",
    enrollment_organization_id: ORG, profile_exists: true, profile_status: "Active", profile_role: "Agent",
    profile_is_super_admin: false, profile_organization_id: ORG, first_name: "Jordan", auth_exists: true,
    email: "jordan@example.test", email_confirmed: true, auth_deleted: false, auth_banned: false,
    organization_status: "active", opted_out: false, ...overrides,
  };
}

function harness(rows: ClaimedDelivery[], contexts: Record<string, DeliveryContext | null>, results: MailResult[] = []) {
  const completed: Array<{ id: string; outcome: CompleteOutcome; providerId: string | null; error: string | null; reason: string | null }> = [];
  const sent: MailMessage[] = [];
  const logs: string[] = [];
  const sleeps: number[] = [];
  const store: OnboardingStore = {
    enrollDue: () => Promise.resolve(2),
    claim: () => Promise.resolve(rows),
    loadContext: (id) => Promise.resolve(contexts[id] ?? null),
    complete: (id, outcome, providerId = null, error = null, reason = null) => {
      completed.push({ id, outcome, providerId, error, reason });
      return Promise.resolve(
        ({ sent: "sent", skipped: "skipped", cancelled: "cancelled", retry: "scheduled", failed: "failed" } as const)[outcome],
      );
    },
  };
  const mailer = (m: MailMessage): Promise<MailResult> => {
    sent.push(m);
    return Promise.resolve(results.shift() ?? { ok: true, id: `re_${sent.length}` });
  };
  const options = {
    siteUrl: "https://www.fflagent.com",
    functionsBaseUrl: "https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1",
    unsubscribeSecret: SECRET,
    now: () => NOW,
    sleep: (ms: number) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    logger: { log: (l: string) => logs.push(l), error: (l: string) => logs.push(l) },
  };
  return { store, mailer, options, completed, sent, logs, sleeps };
}

const row = (id: string, step = "agent_day01_dialer_ready", user = USER): ClaimedDelivery =>
  ({ id, user_id: user, organization_id: ORG, step_key: step, attempts: 1 });

Deno.test("delivery: the kill switch is on only for the exact string 'true'", () => {
  assert.equal(isSendingEnabled("true"), true);
  for (const v of [undefined, "", "TRUE", "1", "yes", " true", "false"]) assert.equal(isSendingEnabled(v), false, String(v));
});

Deno.test("delivery: worker bearer token is required, >= 32 chars, exact", () => {
  const token = "k".repeat(32);
  assert.equal(isAuthorizedWorkerRequest(`Bearer ${token}`, token), true);
  assert.equal(isAuthorizedWorkerRequest(`Bearer ${token}x`, token), false);
  assert.equal(isAuthorizedWorkerRequest(null, token), false);
  assert.equal(isAuthorizedWorkerRequest("Bearer short", "short"), false);
  assert.equal(isAuthorizedWorkerRequest("Bearer ", undefined), false);
});

Deno.test("delivery: an eligible row is sent once with idempotency, one-click unsubscribe and tags", async () => {
  const h = harness([row("d1")], { d1: context("d1") });
  const summary = await processQueue(h.store, h.mailer, h.options);
  assert.deepEqual(summary, { enrolled: 2, claimed: 1, sent: 1, skipped: 0, cancelled: 0, retried: 0, failed: 0, errors: 0 });
  assert.equal(h.sent.length, 1);
  const m = h.sent[0];
  assert.equal(m.to, "jordan@example.test");
  assert.equal(m.subject, "Get your dialer ready before your first call");
  assert.equal(m.idempotencyKey, "onboarding-d1");
  assert.equal(m.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  const oneClick = /^<(https:\/\/jncvvsvckxhqgqvkppmj\.supabase\.co\/functions\/v1\/email-unsubscribe\?token=([^>]+))>$/.exec(m.headers["List-Unsubscribe"]);
  assert.ok(oneClick, m.headers["List-Unsubscribe"]);
  assert.deepEqual(await verifyUnsubscribeToken(SECRET, decodeURIComponent(oneClick[2])), { ok: true, userId: USER, category: "onboarding" });
  assert.ok(m.html.includes("https://www.fflagent.com/email/unsubscribe?token="), "footer link to the confirm page");
  assert.deepEqual(m.tags, [{ name: "category", value: "onboarding" }, { name: "step", value: "agent_day01_dialer_ready" }]);
  assert.deepEqual(h.completed, [{ id: "d1", outcome: "sent", providerId: "re_1", error: null, reason: null }]);
});

Deno.test("delivery: a retried send is byte-identical (safe under the same Idempotency-Key)", async () => {
  const a = harness([row("d1")], { d1: context("d1") });
  const b = harness([row("d1")], { d1: context("d1") });
  await processQueue(a.store, a.mailer, a.options);
  await processQueue(b.store, b.mailer, b.options);
  assert.deepEqual(a.sent[0], b.sent[0]);
});

Deno.test("delivery: ineligible rows are skipped or cancelled and nothing is sent", async () => {
  const h = harness([row("gone"), row("opt"), row("susp"), row("promo")], {
    gone: null,
    opt: context("opt", { opted_out: true }),
    susp: context("susp", { organization_status: "suspended" }),
    promo: context("promo", { profile_role: "Admin" }),
  });
  const summary = await processQueue(h.store, h.mailer, h.options);
  assert.equal(h.sent.length, 0);
  assert.deepEqual(h.completed.map((c) => `${c.id}:${c.outcome}:${c.reason}`),
    ["gone:cancelled:user_deleted", "opt:cancelled:opted_out", "susp:skipped:organization_inactive", "promo:cancelled:role_changed"]);
  assert.equal(summary.cancelled, 3);
  assert.equal(summary.skipped, 1);
});

Deno.test("delivery: provider failures retry or fail; a thrown lookup retries; sends are spaced", async () => {
  const h = harness([row("d1"), row("d2"), row("d3"), row("d4")], {
    d1: context("d1"), d2: context("d2"), d3: context("d3"),
  }, [
    { ok: false, retryable: true, error: "Resend HTTP 500" },
    { ok: false, retryable: false, error: "Resend HTTP 409 invalid_idempotent_request" },
    { ok: true, id: "re_ok" },
  ]);
  h.store.loadContext = (id) =>
    id === "d4" ? Promise.reject(new Error("lookup failed\nwith detail")) : Promise.resolve(context(id));
  const summary = await processQueue(h.store, h.mailer, h.options);
  assert.deepEqual(h.completed.map((c) => `${c.id}:${c.outcome}`), ["d1:retry", "d2:failed", "d3:sent", "d4:retry"]);
  assert.equal(h.completed[3].error, "lookup failed with detail");
  assert.deepEqual(h.sleeps, [600, 600], "spacing between sends, none before the first");
  assert.equal(summary.retried, 2);
  assert.equal(summary.failed, 1);
  assert.equal(summary.sent, 1);
});

Deno.test("delivery: a failed bookkeeping call is counted, not thrown", async () => {
  const h = harness([row("d1")], { d1: context("d1") });
  h.store.complete = () => Promise.reject(new Error("db down"));
  const summary = await processQueue(h.store, h.mailer, h.options);
  assert.equal(summary.errors, 1);
});

Deno.test("delivery: logs carry ids and outcomes, never addresses, names or tokens", async () => {
  const h = harness([row("d1"), row("d2")], { d1: context("d1"), d2: context("d2", { opted_out: true }) });
  await processQueue(h.store, h.mailer, h.options);
  const all = h.logs.join("\n");
  assert.ok(all.includes("delivery=d1") && all.includes("outcome=sent"));
  for (const secretish of ["jordan@example.test", "Jordan", "token=", "v1."]) assert.ok(!all.includes(secretish), secretish);
});

Deno.test("delivery: Resend mailer posts the exact payload and classifies responses", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const respond = (status: number, body: unknown) => (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
  const message: MailMessage = {
    to: "jordan@example.test", subject: "S", html: "<p>h</p>", text: "t", idempotencyKey: "onboarding-d1",
    headers: { "List-Unsubscribe": "<https://x/y>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    tags: [{ name: "category", value: "onboarding" }],
  };
  assert.deepEqual(await createResendMailer("re_key", respond(200, { id: "re_1" }) as typeof fetch)(message), { ok: true, id: "re_1" });
  const sentInit = calls[0].init;
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal((sentInit.headers as Record<string, string>)["Idempotency-Key"], "onboarding-d1");
  const body = JSON.parse(String(sentInit.body));
  assert.equal(body.from, "AgentFlow <team@fflagent.com>");
  assert.deepEqual(body.to, ["jordan@example.test"]);
  assert.deepEqual(body.headers, message.headers);
  assert.deepEqual(body.tags, message.tags);

  const classify = async (status: number, body: unknown) =>
    (await createResendMailer("k", respond(status, body) as typeof fetch)(message));
  assert.deepEqual(await classify(409, { name: "invalid_idempotent_request" }), { ok: false, retryable: false, error: "Resend HTTP 409 invalid_idempotent_request" });
  assert.equal((await classify(422, { name: "validation_error" }) as { retryable: boolean }).retryable, false);
  assert.equal((await classify(400, {}) as { retryable: boolean }).retryable, false);
  assert.equal((await classify(429, {}) as { retryable: boolean }).retryable, true);
  assert.equal((await classify(500, {}) as { retryable: boolean }).retryable, true);
  assert.equal((await classify(401, {}) as { retryable: boolean }).retryable, true);
  const thrown = await createResendMailer("k", (() => Promise.reject(new TypeError("network down"))) as typeof fetch)(message);
  assert.deepEqual(thrown, { ok: false, retryable: true, error: "Resend request failed: network down" });
});

Deno.test("delivery: unsubscribe URLs and error sanitizing", () => {
  const urls = buildUnsubscribeUrls("https://www.fflagent.com/", "https://p.supabase.co/functions/v1/", "v1.a.b");
  assert.equal(urls.pageUrl, "https://www.fflagent.com/email/unsubscribe?token=v1.a.b");
  assert.equal(urls.oneClickUrl, "https://p.supabase.co/functions/v1/email-unsubscribe?token=v1.a.b");
  assert.equal(sanitizeError(new Error("a\r\nb\tc")), "a b c");
  assert.equal(sanitizeError(""), "Unknown error");
  assert.equal(sanitizeError("x".repeat(400)).length, 300);
});
