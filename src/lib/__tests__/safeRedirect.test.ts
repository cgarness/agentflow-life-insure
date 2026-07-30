/**
 * Open-redirect guard for the post-authentication return path.
 *
 * `AcceptGroupInvite` produces `/login?redirect=<internal path>`; this helper is the
 * only consumer. Every string below is an attack payload that defeats a naive
 * `startsWith("/")` check — see WORK_LOG 2026-07-28.
 */
import { describe, it, expect } from "vitest";
import { resolveSafeRedirect, resolvePostAuthDestination, ALLOWED_REDIRECT_PATHS } from "@/lib/safe-redirect";

const ORIGIN = "https://app.example.com";
const CTRL = (code: number) => String.fromCharCode(code);

describe("resolveSafeRedirect", () => {
  it("accepts the allowlisted internal path and preserves its query string", () => {
    expect(resolveSafeRedirect("/accept-group-invite?token=abc123", ORIGIN)).toBe(
      "/accept-group-invite?token=abc123",
    );
  });

  it("accepts the allowlisted path with no query", () => {
    expect(resolveSafeRedirect("/accept-group-invite", ORIGIN)).toBe("/accept-group-invite");
  });

  it("returns null for missing values", () => {
    expect(resolveSafeRedirect(null, ORIGIN)).toBeNull();
    expect(resolveSafeRedirect(undefined, ORIGIN)).toBeNull();
    expect(resolveSafeRedirect("", ORIGIN)).toBeNull();
  });

  describe("rejects off-origin destinations", () => {
    // The canonical open-redirect payloads. //evil.com is the one that passes
    // startsWith("/"); the backslash forms normalize to it in the URL parser.
    const payloads = [
      "//evil.com",
      "//evil.com/path",
      "https://evil.com",
      "HtTpS://evil.com",
      "http://evil.com",
      "javascript:alert(document.cookie)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "blob:https://evil.com/x",
      "\\\\evil.com",
      "/\\evil.com",
      "/\\/evil.com",
      "\\/evil.com",
      "%2F%2Fevil.com",
      "%252F%252Fevil.com",
      "///evil.com",
    ];
    it.each(payloads)("rejects %j", (payload) => {
      expect(resolveSafeRedirect(payload, ORIGIN)).toBeNull();
    });
  });

  describe("rejects values the URL parser would normalize after validation", () => {
    const payloads = [
      `/${CTRL(9)}/evil.com`,
      `/${CTRL(10)}/evil.com`,
      `/${CTRL(13)}/evil.com`,
      ` //evil.com`,
      `${CTRL(0)}//evil.com`,
      `/accept-group-invite${CTRL(9)}`,
    ];
    it.each(payloads.map((p, i) => [i, p] as const))("rejects control-char payload #%i", (_i, payload) => {
      expect(resolveSafeRedirect(payload, ORIGIN)).toBeNull();
    });
  });

  it("rejects internal paths that are not allowlisted", () => {
    // Same-origin but not a permitted destination - fail closed.
    expect(resolveSafeRedirect("/dashboard", ORIGIN)).toBeNull();
    expect(resolveSafeRedirect("/settings?section=agency-group", ORIGIN)).toBeNull();
    expect(resolveSafeRedirect("/login?redirect=/login", ORIGIN)).toBeNull();
  });

  it("rejects relative paths with no leading slash", () => {
    expect(resolveSafeRedirect("accept-group-invite", ORIGIN)).toBeNull();
    expect(resolveSafeRedirect("dashboard", ORIGIN)).toBeNull();
  });

  it("never returns the caller's raw string - only parsed components", () => {
    // Path traversal collapses during canonicalization rather than passing through.
    const out = resolveSafeRedirect("/foo/../accept-group-invite?token=x", ORIGIN);
    expect(out).toBe("/accept-group-invite?token=x");
    expect(out).not.toContain("..");
  });

  it("exposes a deliberately narrow allowlist", () => {
    expect([...ALLOWED_REDIRECT_PATHS]).toEqual(["/accept-group-invite"]);
  });
});

describe("resolvePostAuthDestination", () => {
  const plainUser = { id: "u1", user_metadata: {} } as never;
  const wizardUser = {
    id: "u2",
    email_confirmed_at: "2026-07-28T00:00:00.000Z",
    user_metadata: { needs_app_wizard: true },
  } as never;

  it("honors a valid redirect for a fully onboarded user", () => {
    expect(resolvePostAuthDestination(plainUser, "/accept-group-invite?token=t", ORIGIN)).toBe(
      "/accept-group-invite?token=t",
    );
  });

  it("falls back to /dashboard when there is no redirect", () => {
    expect(resolvePostAuthDestination(plainUser, null, ORIGIN)).toBe("/dashboard");
  });

  it("falls back to /dashboard when the redirect is hostile", () => {
    expect(resolvePostAuthDestination(plainUser, "//evil.com", ORIGIN)).toBe("/dashboard");
    expect(resolvePostAuthDestination(plainUser, "https://evil.com", ORIGIN)).toBe("/dashboard");
  });

  it("ONBOARDING WINS - a redirect cannot be used to skip the wizard gate", () => {
    expect(resolvePostAuthDestination(wizardUser, "/accept-group-invite?token=t", ORIGIN)).toBe("/onboarding");
  });
});
