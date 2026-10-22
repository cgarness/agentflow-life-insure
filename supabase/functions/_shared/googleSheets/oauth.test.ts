import { assert, assertEquals, assertRejects, assertThrows } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { buildAuthUrl, checkScopes, inspectAccessToken, normalizeScopes, refreshAccessToken, validateIdToken } from "./oauth.ts";
import { pkceChallenge, encryptString, decryptString } from "./crypto.ts";
import { classifyGoogleError, GoogleApiError, sanitizeError } from "./errors.ts";
import { readConfig } from "./config.ts";

const CFG = { enabled: true, clientId: "cid.apps.googleusercontent.com", clientSecret: "sec", redirectUri: "https://x.supabase.co/functions/v1/google-sheets-oauth-callback",
  allowedOrigins: ["https://www.fflagent.com"], stateKey: "k".repeat(40), workerToken: "w".repeat(40) };
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const idt = (claims: Record<string, unknown>) => `${b64({ alg: "RS256" })}.${b64(claims)}.sig`;
const resp = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status }));

Deno.test("auth URL: exact scopes, offline, consent, PKCE S256, include_granted_scopes=false", () => {
  const u = new URL(buildAuthUrl(CFG, "st", "ch", "a@b.test"));
  assertEquals(u.searchParams.get("scope"), "openid email https://www.googleapis.com/auth/drive.file");
  assertEquals(u.searchParams.get("include_granted_scopes"), "false");
  assertEquals(u.searchParams.get("code_challenge_method"), "S256");
  assertEquals(u.searchParams.get("access_type"), "offline");
  assertEquals(u.searchParams.get("prompt"), "consent");
  assertEquals(u.searchParams.get("login_hint"), "a@b.test");
});

Deno.test("scopes: equivalent names normalised; drive.file required; broader access rejected", () => {
  const s = normalizeScopes("openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive.file");
  assertEquals(s, ["email", "https://www.googleapis.com/auth/drive.file", "openid"]);
  assert(checkScopes(s).ok);
  assertEquals(checkScopes(normalizeScopes("openid email")), { ok: false, reason: "missing_drive_file" });
  assertEquals(checkScopes(normalizeScopes("openid email https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/gmail.readonly")),
    { ok: false, reason: "excess_scope" });
  assertEquals(checkScopes(normalizeScopes("email https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.profile")).ok, false);
});

Deno.test("id_token: issuer, audience, expiry, subject and verified email enforced", () => {
  const now = 1_800_000_000;
  const good = { iss: "https://accounts.google.com", aud: CFG.clientId, exp: now + 300, sub: "123", email: "a@b.test", email_verified: true };
  assertEquals(validateIdToken(idt(good), CFG.clientId, now).sub, "123");
  assertThrows(() => validateIdToken(idt({ ...good, iss: "evil" }), CFG.clientId, now));
  assertThrows(() => validateIdToken(idt({ ...good, aud: "other" }), CFG.clientId, now));
  assertThrows(() => validateIdToken(idt({ ...good, exp: now - 3600 }), CFG.clientId, now));
  assertThrows(() => validateIdToken(idt({ ...good, email_verified: false }), CFG.clientId, now));
  assertThrows(() => validateIdToken(idt({ ...good, sub: "" }), CFG.clientId, now));
  assertThrows(() => validateIdToken(undefined, CFG.clientId, now));
});

Deno.test("refresh: invalid_grant → reconnect; 429 → quota; 5xx → transient", async () => {
  const e1 = await assertRejects(() => refreshAccessToken(() => resp(400, { error: "invalid_grant" }), CFG, "rt"), GoogleApiError);
  assertEquals(e1.failure, "reconnect");
  const e2 = await assertRejects(() => refreshAccessToken(() => resp(429, {}), CFG, "rt"), GoogleApiError);
  assertEquals(e2.failure, "quota");
  const e3 = await assertRejects(() => refreshAccessToken(() => resp(503, {}), CFG, "rt"), GoogleApiError);
  assertEquals(e3.failure, "transient");
  const ok = await refreshAccessToken(() => resp(200, { access_token: "ya29.x", expires_in: 3599 }), CFG, "rt");
  assertEquals(ok.expires_in, 3599);
});

Deno.test("tokeninfo: actual scopes are read from the token", async () => {
  const info = await inspectAccessToken(() => resp(200, { scope: "openid https://www.googleapis.com/auth/drive.file email", expires_in: "1200", aud: "cid" }), "t");
  assertEquals(info.expiresIn, 1200);
  assert(checkScopes(info.scopes).ok);
});

Deno.test("errors: a quota or API-configuration 403 is not lost file access", () => {
  assertEquals(classifyGoogleError(403, { error: { errors: [{ reason: "rateLimitExceeded" }] } }).failure, "quota");
  assertEquals(classifyGoogleError(403, { error: { status: "PERMISSION_DENIED", details: [{ reason: "SERVICE_DISABLED" }] } }).failure, "api_not_enabled");
  assertEquals(classifyGoogleError(403, { error: { errors: [{ reason: "insufficientPermissions" }] } }).failure, "reconnect");
  assertEquals(classifyGoogleError(403, { error: { status: "PERMISSION_DENIED" } }).failure, "access_lost");
  assertEquals(classifyGoogleError(404, {}).failure, "access_lost");
  assertEquals(classifyGoogleError(429, {}).failure, "quota");
  assertEquals(classifyGoogleError(500, {}).failure, "transient");
  assertEquals(classifyGoogleError(400, {}).failure, "other");
});

Deno.test("sanitizeError redacts tokens, JWTs, secrets and emails", () => {
  const s = sanitizeError("ya29.abc 1//xyz Bearer foo refresh_token=bar eyJa.eyJb.sig a@b.test client_secret=zz");
  assert(!/ya29\.abc|1\/\/xyz|foo|bar|eyJa|a@b\.test|zz/.test(s), s);
});

Deno.test("PKCE S256 matches RFC 7636 appendix B; AES-GCM binds AAD", async () => {
  assertEquals(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  const key = "s".repeat(40);
  const ct = await encryptString(key, "verifier", "aad1");
  assertEquals(await decryptString(key, ct, "aad1"), "verifier");
  await assertRejects(() => decryptString(key, ct, "aad2"));
  await assertRejects(() => decryptString("t".repeat(40), ct, "aad1"));
  await assertRejects(() => encryptString("short", "x", "y"));
});

Deno.test("config: only https origins; disabled unless explicitly true", () => {
  const env = new Map([["GOOGLE_SHEETS_ALLOWED_RETURN_ORIGINS", "https://www.fflagent.com/, http://evil.test, https://fflagent.com"],
                       ["GOOGLE_SHEETS_ENABLED", "yes"]]);
  const c = readConfig({ get: (k) => env.get(k) });
  assertEquals(c.allowedOrigins, ["https://www.fflagent.com", "https://fflagent.com"]);
  assertEquals(c.enabled, false);
});
