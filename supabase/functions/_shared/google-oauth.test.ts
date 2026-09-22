import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CALENDAR_SCOPES, exchangeGoogleCode, GMAIL_SCOPES, hasGoogleScopes, revokeGoogleToken, safeOAuthError, settingsRedirect } from "./google-oauth";
const vars: Record<string, string> = {};
beforeEach(() => { for (const k of Object.keys(vars)) delete vars[k]; vi.stubGlobal("Deno", { env: { get: (k: string) => vars[k] } }); });
afterEach(() => vi.unstubAllGlobals());
describe("Google OAuth input and consent", () => {
  it("does not equate an invalid revocation token with a confirmed revoked grant", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "invalid_token" }), { status: 400 })));
    expect(await revokeGoogleToken("synthetic-token")).toBe(false);
  });
  it("returns only canonical settings URLs", () => {
    expect(settingsRedirect("email", "https://www.fflagent.com/settings?next=https://evil.test#fragment")).toBe("https://www.fflagent.com/settings?section=email-settings");
    expect(settingsRedirect("calendar")).toBe("https://www.fflagent.com/settings?section=calendar-settings");
  });
  it.each(["https://evil.test/settings", "https://www.fflagent.com.evil.test/settings", "https://www.fflagent.com/login", "https://user@www.fflagent.com/settings", "//evil.test/settings", "javascript:alert(1)"])("rejects unsafe destination %s", value => {
    expect(() => settingsRedirect("email", value)).toThrow();
  });
  it("requires an explicit localhost configuration", () => {
    vars.GOOGLE_OAUTH_APP_ORIGIN = "http://localhost:5173";
    expect(() => settingsRedirect("email")).toThrow();
    vars.GOOGLE_OAUTH_ALLOW_LOCAL = "true";
    expect(settingsRedirect("email")).toContain("http://localhost:5173/settings");
  });
  it("checks both Gmail permissions and accepts previously granted broad Calendar access", () => {
    expect(hasGoogleScopes(GMAIL_SCOPES.join(" "), "email")).toBe(true);
    expect(hasGoogleScopes("https://www.googleapis.com/auth/gmail.send", "email")).toBe(false);
    expect(hasGoogleScopes(CALENDAR_SCOPES.join(" "), "calendar")).toBe(true);
    expect(hasGoogleScopes("https://www.googleapis.com/auth/calendar", "calendar")).toBe(true);
    expect(hasGoogleScopes(null, "calendar")).toBe(false);
  });
  it("does not reflect arbitrary errors into redirect URLs", () => {
    expect(safeOAuthError(new Error("private token detail"))).toBe("connection_failed");
    expect(safeOAuthError(new Error("required_permissions_missing"))).toBe("required_permissions_missing");
  });
  it("rejects partial consent before calling userinfo", async () => {
    Object.assign(vars, { GOOGLE_CLIENT_ID: "fake", GOOGLE_CLIENT_SECRET: "fake", EMAIL_GOOGLE_CALLBACK_URL: "https://callback.test" });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: "fake", expires_in: 3600, scope: "openid" })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(exchangeGoogleCode("fake-code", "email")).rejects.toThrow("required_permissions_missing");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("requires a verified stable Google account identity", async () => {
    Object.assign(vars, { GOOGLE_CLIENT_ID: "fake", GOOGLE_CLIENT_SECRET: "fake", EMAIL_GOOGLE_CALLBACK_URL: "https://callback.test" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "fake", expires_in: 3600, scope: GMAIL_SCOPES.join(" ") }))).mockResolvedValueOnce(new Response(JSON.stringify({ id: "account", email: "user@example.test", verified_email: false }))));
    await expect(exchangeGoogleCode("fake-code", "email")).rejects.toThrow("google_account_not_verified");
  });
});
