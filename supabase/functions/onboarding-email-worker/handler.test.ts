// Run: deno test --allow-read --allow-env supabase/functions/onboarding-email-worker/
import assert from "node:assert/strict";
import { createOnboardingWorkerHandler, type WorkerDeps } from "./handler.ts";
import type { OnboardingStore } from "../_shared/onboardingEmail/delivery.ts";

const TOKEN = "w".repeat(40);
const ENABLED_ENV: Record<string, string> = {
  ONBOARDING_EMAIL_WORKER_TOKEN: TOKEN,
  ONBOARDING_EMAILS_SEND_ENABLED: "true",
  RESEND_API_KEY: "re_test",
  EMAIL_UNSUBSCRIBE_SECRET: "e".repeat(40),
  SUPABASE_URL: "https://jncvvsvckxhqgqvkppmj.supabase.co",
};

function setup(env: Record<string, string | undefined>, store?: Partial<OnboardingStore>) {
  const calls = { createStore: 0, createMailer: 0, enroll: 0, claim: 0 };
  const logs: string[] = [];
  const deps: WorkerDeps = {
    getEnv: (name) => env[name],
    createStore: () => {
      calls.createStore++;
      return {
        enrollDue: () => {
          calls.enroll++;
          return Promise.resolve(0);
        },
        claim: () => {
          calls.claim++;
          return Promise.resolve([]);
        },
        loadContext: () => Promise.resolve(null),
        complete: () => Promise.resolve(null),
        ...store,
      };
    },
    createMailer: () => {
      calls.createMailer++;
      return () => Promise.resolve({ ok: true, id: null });
    },
    now: () => new Date("2026-10-12T15:00:00Z"),
    sleep: () => Promise.resolve(),
    logger: { log: (l) => logs.push(l), error: (l) => logs.push(l) },
  };
  return { handler: createOnboardingWorkerHandler(deps), calls, logs };
}

const post = (auth?: string) =>
  new Request("https://x.supabase.co/functions/v1/onboarding-email-worker", {
    method: "POST",
    headers: auth ? { Authorization: auth } : {},
    body: JSON.stringify({ to: "attacker@example.test", html: "<b>x</b>" }),
  });

Deno.test("worker: POST only", async () => {
  const { handler, calls } = setup(ENABLED_ENV);
  assert.equal((await handler(new Request("https://x/", { method: "GET" }))).status, 405);
  assert.equal(calls.createStore, 0);
});

Deno.test("worker: missing, wrong or short tokens are 403 and touch nothing", async () => {
  for (const [env, auth] of [
    [ENABLED_ENV, undefined],
    [ENABLED_ENV, "Bearer wrong"],
    [ENABLED_ENV, `Bearer ${TOKEN}x`],
    [{ ...ENABLED_ENV, ONBOARDING_EMAIL_WORKER_TOKEN: "short" }, "Bearer short"],
    [{ ...ENABLED_ENV, ONBOARDING_EMAIL_WORKER_TOKEN: undefined }, "Bearer "],
  ] as const) {
    const { handler, calls } = setup(env as Record<string, string | undefined>);
    assert.equal((await handler(post(auth))).status, 403);
    assert.equal(calls.createStore, 0);
  }
});

Deno.test("worker: the Edge kill switch OFF means no database client, no enrollment, no send", async () => {
  for (const value of [undefined, "", "false", "TRUE", "1"]) {
    const { handler, calls } = setup({ ...ENABLED_ENV, ONBOARDING_EMAILS_SEND_ENABLED: value });
    const res = await handler(post(`Bearer ${TOKEN}`));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, disabled: true });
    assert.deepEqual(calls, { createStore: 0, createMailer: 0, enroll: 0, claim: 0 }, `value ${value}`);
  }
});

Deno.test("worker: missing provider or unsubscribe configuration is 503 before any claim", async () => {
  for (const missing of [
    { RESEND_API_KEY: "" },
    { EMAIL_UNSUBSCRIBE_SECRET: "too-short" },
    { SUPABASE_URL: "" },
    { SUPABASE_URL: "http://insecure.example.test" },
  ]) {
    const { handler, calls, logs } = setup({ ...ENABLED_ENV, ...missing });
    assert.equal((await handler(post(`Bearer ${TOKEN}`))).status, 503, JSON.stringify(missing));
    assert.equal(calls.createStore, 0);
    assert.ok(!logs.join(" ").includes("re_test") && !logs.join(" ").includes("eeee"), "no secret in logs");
  }
});

Deno.test("worker: an enabled, configured run enrolls then claims and reports a summary", async () => {
  const { handler, calls } = setup(ENABLED_ENV);
  const res = await handler(post(`Bearer ${TOKEN}`));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, enrolled: 0, claimed: 0, sent: 0, skipped: 0, cancelled: 0, retried: 0, failed: 0, errors: 0 });
  assert.deepEqual(calls, { createStore: 1, createMailer: 1, enroll: 1, claim: 1 });
});

Deno.test("worker: a failed run is 500 with no detail leaked", async () => {
  const { handler } = setup(ENABLED_ENV, { claim: () => Promise.reject(new Error("claim: permission denied for table x")) });
  const res = await handler(post(`Bearer ${TOKEN}`));
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: "Run failed" });
});
