// Run: deno test --allow-env supabase/functions/google-sheets-oauth-start/index.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { handle, type StartDeps } from "./index.ts";

const ENV: Record<string, string> = {
  GOOGLE_SHEETS_ENABLED: "true", GOOGLE_SHEETS_CLIENT_ID: "cid", GOOGLE_SHEETS_CLIENT_SECRET: "sec",
  GOOGLE_SHEETS_REDIRECT_URI: "https://x.supabase.co/functions/v1/google-sheets-oauth-callback",
  GOOGLE_SHEETS_ALLOWED_RETURN_ORIGINS: "https://www.fflagent.com", GOOGLE_SHEETS_STATE_KEY: "k".repeat(40),
};
function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>) {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) { prev[k] = Deno.env.get(k); v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v); }
  return fn().finally(() => { for (const [k, v] of Object.entries(prev)) v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v); });
}
const post = (body: unknown) => new Request("https://x/functions/v1/google-sheets-oauth-start", {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer jwt" }, body: JSON.stringify(body) });

function deps(over: Partial<StartDeps> = {}): StartDeps & { states: unknown[] } {
  const states: unknown[] = [];
  return { states, authenticate: async () => ({ userId: "u1", orgId: "o1" }),
    createState: async (...a) => { states.push(a); return {}; }, loginHint: async () => null, ...over };
}

Deno.test("oauth-start: disabled / unconfigured / bad origin / unauthenticated are refused", async () => {
  await withEnv({ ...ENV, GOOGLE_SHEETS_ENABLED: undefined }, async () => assertEquals((await handle(post({ return_origin: "https://www.fflagent.com" }), deps())).status, 503));
  await withEnv({ ...ENV, GOOGLE_SHEETS_STATE_KEY: "short" }, async () => assertEquals((await handle(post({ return_origin: "https://www.fflagent.com" }), deps())).status, 503));
  await withEnv(ENV, async () => {
    assertEquals((await handle(post({ return_origin: "https://evil.test" }), deps())).status, 400);
    assertEquals((await handle(post({ return_origin: "https://www.fflagent.com" }), deps({ authenticate: async () => null }))).status, 401);
    assertEquals((await handle(post({ return_origin: "https://www.fflagent.com" }), deps({ createState: async () => ({ error: "not_permitted" }) }))).status, 403);
  });
});

Deno.test("oauth-start: stores only a state hash + encrypted verifier and returns a PKCE URL", async () => {
  await withEnv(ENV, async () => {
    const d = deps();
    const res = await handle(post({ return_origin: "https://www.fflagent.com/" }), d);
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Cache-Control"), "no-store");
    const { url } = await res.json();
    const u = new URL(url);
    const [user, org, hash, enc, origin] = d.states[0] as string[];
    assertEquals([user, org, origin], ["u1", "o1", "https://www.fflagent.com"]);
    assert(/^[0-9a-f]{64}$/.test(hash));
    assert(u.searchParams.get("state") !== hash, "raw state is never stored");
    assert(!enc.includes(u.searchParams.get("code_challenge")!));
    assertEquals(u.searchParams.get("include_granted_scopes"), "false");
  });
});
