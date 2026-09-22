import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeToken, encodeToken, GoogleOAuthError, refreshGoogleAccessToken, tokenContext } from "./google-token";
const key = Buffer.alloc(32, 7).toString("base64");
const config = { GOOGLE_TOKEN_KEYS: JSON.stringify({ primary: key }) };
const env = (extra: Record<string, string> = {}) => (name: string) => ({ ...config, ...extra })[name];
const context = tokenContext("email", "synthetic-user", "access");
afterEach(() => vi.unstubAllGlobals());
describe("Google token envelope", () => {
  it("encrypts reversibly with a different nonce for each write", async () => {
    const values = await Promise.all(Array.from({ length: 24 }, () => encodeToken("synthetic-token", context, env())));
    expect(new Set(values).size).toBe(24);
    expect(values.every(v => v?.startsWith("gct.v1.primary.") && !v.includes("synthetic-token"))).toBe(true);
    expect(await decodeToken(values[0], context, env())).toBe("synthetic-token");
  });
  it("binds ciphertext to owner, integration and token purpose", async () => {
    const stored = await encodeToken("private", context, env());
    for (const other of [tokenContext("email", "other-user", "access"), tokenContext("calendar", "synthetic-user", "access"), tokenContext("email", "synthetic-user", "refresh")]) {
      await expect(decodeToken(stored, other, env())).rejects.toThrow("authenticated");
    }
  });
  it("rejects tampering, unsupported versions and wrong keys even with legacy mode enabled", async () => {
    const stored = (await encodeToken("private", context, env()))!;
    const parts = stored.split(".");
    parts[4] = (parts[4][0] === "A" ? "B" : "A") + parts[4].slice(1);
    await expect(decodeToken(parts.join("."), context, env({ GOOGLE_TOKEN_ALLOW_LEGACY_READ: "true" }))).rejects.toThrow("authenticated");
    await expect(decodeToken(stored.replace("gct.v1.", "gct.v2."), context, env({ GOOGLE_TOKEN_ALLOW_LEGACY_READ: "true" }))).rejects.toThrow("envelope");
    await expect(decodeToken(stored, context, env({ GOOGLE_TOKEN_KEYS: JSON.stringify({ primary: Buffer.alloc(32, 9).toString("base64") }) }))).rejects.toThrow("authenticated");
  });
  it("fails closed without a usable key", async () => {
    await expect(encodeToken("private", context, () => undefined)).rejects.toThrow("key is unavailable");
    await expect(encodeToken("private", context, env({ GOOGLE_TOKEN_KEYS: '{"primary":"short"}' }))).rejects.toThrow("key is unavailable");
  });
  it("only reads legacy tokens during an explicit migration window", async () => {
    await expect(decodeToken(btoa("old.token"), context, env())).rejects.toThrow("requires migration");
    const migrationEnv = env({ GOOGLE_TOKEN_ALLOW_LEGACY_READ: "true" });
    expect(await decodeToken(btoa("old.token"), context, migrationEnv)).toBe("old.token");
    expect(await decodeToken("old.token", context, migrationEnv)).toBe("old.token");
    const converted = await encodeToken(await decodeToken(btoa("old.token"), context, migrationEnv), context, env());
    expect(await decodeToken(converted, context, env())).toBe("old.token");
  });
  it("requires both transition flags for temporary legacy writes", async () => {
    await expect(encodeToken("old.token", context, env({ GOOGLE_TOKEN_WRITE_FORMAT: "legacy" }))).rejects.toThrow("transition");
    expect(await encodeToken("old.token", context, env({ GOOGLE_TOKEN_WRITE_FORMAT: "legacy", GOOGLE_TOKEN_ALLOW_LEGACY_READ: "true" }))).toBe(btoa("old.token"));
  });
  it("handles disconnected empty values without a key", async () => {
    expect(await encodeToken(null, context, () => undefined)).toBeNull();
    expect(await decodeToken("", context, () => undefined)).toBeNull();
  });
});
describe("Google refresh", () => {
  const request = { refreshToken: "synthetic-refresh", clientId: "synthetic-client", clientSecret: "synthetic-secret" };
  it("validates expiry and sends credentials in the request body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: "fresh", expires_in: 3600 })));
    vi.stubGlobal("fetch", fetchMock);
    const result = await refreshGoogleAccessToken(request);
    expect(result.accessToken).toBe("fresh");
    expect(result.expiresIn).toBe(3600);
    expect(fetchMock.mock.calls[0][0]).toBe("https://oauth2.googleapis.com/token");
    expect(fetchMock.mock.calls[0][1].body.get("refresh_token")).toBe("synthetic-refresh");
  });
  it("distinguishes revoked access and never reflects a provider response body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "invalid_grant", error_description: "SENSITIVE_PROVIDER_DETAIL" }), { status: 400 })));
    const error = await refreshGoogleAccessToken(request).catch(e => e);
    expect(error).toBeInstanceOf(GoogleOAuthError);
    expect(error.code).toBe("invalid_grant");
    expect(error.message).not.toContain("SENSITIVE");
  });
  it("rejects malformed token responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: "fresh", expires_in: "no" }))));
    await expect(refreshGoogleAccessToken(request)).rejects.toThrow("incomplete");
  });
});
