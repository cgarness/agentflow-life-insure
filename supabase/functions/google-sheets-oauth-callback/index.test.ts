// Run: deno test --allow-env supabase/functions/google-sheets-oauth-callback/index.test.ts
import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { handle, type CallbackDeps, type ConsumedState } from "./index.ts";
import { encryptString, sha256Hex } from "../_shared/googleSheets/crypto.ts";

const ENV: Record<string, string> = {
  GOOGLE_SHEETS_ENABLED: "true", GOOGLE_SHEETS_CLIENT_ID: "cid", GOOGLE_SHEETS_CLIENT_SECRET: "sec",
  GOOGLE_SHEETS_REDIRECT_URI: "https://x.supabase.co/functions/v1/google-sheets-oauth-callback",
  GOOGLE_SHEETS_ALLOWED_RETURN_ORIGINS: "https://www.fflagent.com", GOOGLE_SHEETS_STATE_KEY: "k".repeat(40),
};
for (const [k, v] of Object.entries(ENV)) Deno.env.set(k, v);
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const idToken = (o: Record<string, unknown> = {}) => `${b64({ alg: "RS256" })}.${b64({ iss: "https://accounts.google.com", aud: "cid",
  exp: Math.floor(Date.now() / 1000) + 300, sub: "G1", email: "a@b.test", email_verified: true, ...o })}.sig`;

async function setup(opts: { scope?: string; userinfoSub?: string; storeOutcome?: string; consumed?: boolean; idClaims?: Record<string, unknown> } = {}) {
  const state = "raw-state-value";
  const hash = await sha256Hex(state);
  const stored: unknown[] = [];
  const consumedRow: ConsumedState = { user_id: "u1", organization_id: "o1", auth_generation: 4, return_origin: "https://www.fflagent.com",
    verifier_enc: await encryptString(ENV.GOOGLE_SHEETS_STATE_KEY, "the-verifier", hash) };
  const deps: CallbackDeps = {
    consume: async (h) => (h === hash && opts.consumed !== false ? consumedRow : null),
    store: async (...a) => { stored.push(a); return opts.storeOutcome ?? "connected"; },
    fetchFn: ((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const r = (s: number, b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: s }));
      if (url.includes("/token")) {
        const form = new URLSearchParams(String(init?.body));
        if (form.get("code_verifier") !== "the-verifier") return r(400, { error: "invalid_grant" });
        return r(200, { access_token: "ya29.a", expires_in: 3600, refresh_token: "1//rt", id_token: idToken(opts.idClaims),
          scope: opts.scope ?? "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive.file" });
      }
      if (url.includes("userinfo")) return r(200, { sub: opts.userinfoSub ?? "G1" });
      return r(404, {});
    }) as typeof fetch,
  };
  return { deps, stored, url: `https://x/functions/v1/google-sheets-oauth-callback?state=${state}&code=abc` };
}
const loc = (r: Response) => new URL(r.headers.get("Location")!).searchParams.get("sheets");

Deno.test("callback: success stores Vault token via generation-bound RPC and redirects to the allowlisted origin", async () => {
  const s = await setup();
  const res = await handle(new Request(s.url), s.deps);
  assertEquals(res.status, 302);
  assertEquals(res.headers.get("Location"), "https://www.fflagent.com/settings?section=google-sheets&sheets=connected");
  const [st, sub, email, scopes, rt] = s.stored[0] as [ConsumedState, string, string, string[], string];
  assertEquals([st.auth_generation, sub, email, rt], [4, "G1", "a@b.test", "1//rt"]);
  assertEquals(scopes, ["email", "https://www.googleapis.com/auth/drive.file", "openid"]);
});

Deno.test("callback: replayed/expired state, denied consent, missing or excess scopes, identity mismatch", async () => {
  let s = await setup({ consumed: false });
  assertEquals(loc(await handle(new Request(s.url), s.deps)), "expired");
  s = await setup();
  assertEquals(loc(await handle(new Request(s.url.replace("code=abc", "error=access_denied")), s.deps)), "denied");
  s = await setup({ scope: "openid email" });
  assertEquals(loc(await handle(new Request(s.url), s.deps)), "scope_denied");
  assertEquals(s.stored.length, 0);
  s = await setup({ scope: "openid email https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive" });
  assertEquals(loc(await handle(new Request(s.url), s.deps)), "scope_denied");
  s = await setup({ userinfoSub: "OTHER" });
  assertEquals(loc(await handle(new Request(s.url), s.deps)), "error");
  assertEquals(s.stored.length, 0);
  s = await setup({ idClaims: { aud: "someone-else" } });
  assertEquals(loc(await handle(new Request(s.url), s.deps)), "error");
});

Deno.test("callback: late callback after disconnect (superseded) → expired; account mismatch surfaced", async () => {
  let s = await setup({ storeOutcome: "superseded" });
  assertEquals(loc(await handle(new Request(s.url), s.deps)), "expired");
  s = await setup({ storeOutcome: "account_mismatch" });
  assertEquals(loc(await handle(new Request(s.url), s.deps)), "account_mismatch");
  s = await setup({ storeOutcome: "no_refresh_token" });
  assertEquals(loc(await handle(new Request(s.url), s.deps)), "no_offline_access");
});
