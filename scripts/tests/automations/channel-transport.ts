import { request } from "node:http";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { dispatchChannel } from "../../../supabase/functions/_shared/automations/channel.ts";
import {
  type AutomationClaim,
  runAutomationClaim,
} from "../../../supabase/functions/_shared/automations/runtime.ts";
export const endpoint = "http://127.0.0.1:54340";
const config = JSON.parse(
  await Deno.readTextFile(
    (Deno.env.get("AUTOMATION_TEST_SETTINGS") ?? Deno.env.get("AUTOMATIONS_LOCAL_SETTINGS"))!,
  ),
);
if (
  config.API_URL !== endpoint || !/^(automation-fresh|af-auto-test-[0-9]+-db)$/.test(config.DB_CONTAINER)
) throw Error("Synthetic loopback database required");

for (const [token, role] of [[config.SERVICE_ROLE_KEY, "service_role"], [config.ANON_KEY, "anon"]]) {
  const payload = JSON.parse(atob(String(token).split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  if (payload.iss !== "supabase-demo" || payload.role !== role || payload.exp * 1000 <= Date.now()) {
    throw new Error("Current isolated fixture credentials required");
  }
}
export const calls: URLSearchParams[] = [];
export const emails: { subject: string; text: string; from: string; reply_to: string }[] = [];
let permitted = true;
export function allowConsent(value: boolean) {
  permitted = value;
}
const interceptors: { match: (url: URL, body: string) => boolean; action: () => Promise<void> }[] = [];
/** Runs `action` once, just before the first local database request that `match` accepts is sent. */
export function interceptOnce(match: (url: URL, body: string) => boolean, action: () => Promise<void>) {
  interceptors.push({ match, action });
}
export const pendingInterceptors = () => interceptors.length;
export const testFetch: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
  if (url.origin === endpoint) {
    const due = interceptors.findIndex((item) => item.match(url, typeof init?.body === "string" ? init.body : ""));
    if (due >= 0) await interceptors.splice(due, 1)[0].action();
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : {}));
    headers.set("Connection", "close");
    if (typeof init?.body === "string") {
      headers.set("Content-Length", String(new TextEncoder().encode(init.body).length));
    }
    const target = config.DB_CONTAINER === "automation-fresh" && url.pathname.startsWith("/rest/v1/")
      ? "http://127.0.0.1:54334" + url.pathname.slice(8) + url.search
      : url;
    const res = await new Promise<Response>((resolve, reject) => {
      const local = request(target, {
        method: init?.method ?? "GET",
        agent: false,
        headers: Object.fromEntries(headers),
      }, (incoming) => {
        const parts: Uint8Array[] = [];
        incoming.on("data", (part) => parts.push(part));
        incoming.on(
          "end",
          () =>
            resolve(
              new Response(parts.length ? new Blob(parts as BlobPart[]) : null, {
                status: incoming.statusCode,
                headers: new Headers(incoming.headers as Record<string, string>),
              }),
            ),
        );
        incoming.on("error", reject);
      });
      local.setTimeout(
        5000,
        () => local.destroy(new Error("Loopback request timeout: " + url.pathname)),
      );
      local.on("error", (err) => {
        console.error("Loopback error", url.pathname, err.message);
        reject(err);
      });
      local.end(init?.body ?? undefined);
    });
    if (!res.ok) {
      const localError = await res.clone().json().catch(() => ({}));
      console.error(
        "Local test database",
        url.pathname,
        res.status,
        localError.code,
        localError.message,
      );
    }
    return res;
  }
  if (url.origin === "https://api.resend.com" && url.pathname === "/emails") {
    emails.push(JSON.parse(String(init?.body)));
    return Response.json({ id: crypto.randomUUID() });
  }
  if (url.pathname.endsWith("/agentflow-consent")) {
    const payload = JSON.parse(String(init?.body));
    return Response.json({
      ...payload,
      allowed: permitted,
      checked_at: new Date().toISOString(),
      evidence: [{ id: id(99) }],
    });
  }
  if (url.hostname === "api.twilio.com" && url.pathname.endsWith("/Messages.json")) {
    const form = new URLSearchParams(String(init?.body));
    calls.push(form);
    return Response.json({ sid: "SM" + crypto.randomUUID().replaceAll("-", ""), status: "queued" });
  }
  if (url.hostname === "api.twilio.com" || url.hostname === "messaging.twilio.com") {
    return Response.json({
      sid: url.pathname.match(/PN[0-9a-f]{32}/i)?.[0],
      account_sid: account,
      phone_number: suffix === "b1" ? "+12025550181" : "+12025550141",
      service_sid: "MG" + "0".repeat(30) + suffix,
      capabilities: { sms: true },
    });
  }
  throw new Error("External transport refused");
};
export function id(n: number) {
  return "aacc0000-0000-4000-8000-" + String(n).padStart(12, "0");
}
const suffix = Deno.env.get("AUTOMATION_TEST_ACCOUNT_SUFFIX") === "b1" ? "b1" : "a1";
const account = "AC" + "0".repeat(30) + suffix;
Deno.env.set("TWILIO_MASTER_ACCOUNT_SID", account);
Deno.env.set("TWILIO_MASTER_AUTH_TOKEN", "synthetic-only");
Deno.env.set("SMS_BRIDGE_SECRET", "synthetic-only-sms-eligibility-test-secret");
globalThis.fetch = testFetch;
export const db = createClient(endpoint, config.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export async function processClaim(claim: AutomationClaim) {
  await runAutomationClaim(
    db,
    claim,
    (db, claim, node, contact) =>
      dispatchChannel(db, claim, node, contact, {
        fetch: testFetch,
        env: (name) => name === "SUPABASE_URL" ? endpoint : "synthetic-fixture-only",
      }),
  );
}
