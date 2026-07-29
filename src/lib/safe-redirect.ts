import type { User } from "@supabase/supabase-js";
import { resolvePostAuthPath } from "@/lib/onboarding-wizard";

/**
 * Post-authentication return-path handling.
 *
 * `AcceptGroupInvite` sends unauthenticated users to `/login?redirect=<internal path>`.
 * Before this helper existed the parameter had no consumer, so the invitation was
 * silently dropped and the user landed on `/dashboard` (see WORK_LOG 2026-07-28).
 *
 * The value is fully attacker-controlled — a phishing link on the real production
 * origin is exactly what makes open redirects effective — so validation is an
 * ALLOWLIST, never a denylist, and callers navigate to the parsed components
 * (`pathname + search`) rather than the raw string.
 */

/** Internal paths a `?redirect=` value is permitted to resolve to. */
export const ALLOWED_REDIRECT_PATHS: readonly string[] = ["/accept-group-invite"];

/** Any URL scheme (`javascript:`, `data:`, `https:`) — rejected outright. */
const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/**
 * True if the value contains a C0 control, space, or DEL (U+0000-U+0020, U+007F).
 *
 * Browsers strip Tab/LF/CR from URLs *after* validation would have run, so these
 * must be rejected up front rather than trimmed. Written as a character-code scan
 * rather than a regex so the source stays printable ASCII.
 */
function hasControlOrWhitespace(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Validate a caller-supplied redirect value.
 *
 * @returns the safe `pathname + search` to navigate to, or `null` if the value is
 *   missing, malformed, or points anywhere outside the allowlist.
 */
export function resolveSafeRedirect(
  raw: string | null | undefined,
  origin: string = typeof window !== "undefined" ? window.location.origin : "",
): string | null {
  if (!raw || !origin) return null;

  // Reject before parsing: backslashes normalize to "/" for special schemes, and
  // control/whitespace chars are stripped by the URL parser after we would have
  // looked at them. Both are classic validate-then-normalize bypasses.
  if (hasControlOrWhitespace(raw)) return null;
  if (raw.includes("\\")) return null;
  if (HAS_SCHEME.test(raw)) return null;

  // Must be a single-slash-rooted path. The second check is what rejects the
  // protocol-relative "//evil.com", which passes a naive startsWith("/").
  if (raw[0] !== "/" || raw[1] === "/") return null;

  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return null;
  }

  // Canonicalized comparison — this, not the string checks, is the real guarantee.
  if (url.origin !== origin) return null;
  if (!ALLOWED_REDIRECT_PATHS.includes(url.pathname)) return null;

  // Return the PARSED components, never the caller's original string.
  return `${url.pathname}${url.search}`;
}

/**
 * The single source of truth for "where does this user go after signing in?".
 *
 * Onboarding always wins: a user who still needs the wizard cannot be routed past
 * it by supplying `?redirect=`, which would otherwise turn the parameter into a
 * way to bypass the gate in `App.tsx`.
 *
 * Used by BOTH sinks — the login page and `PublicRoute` — because an already
 * authenticated visitor is redirected by `PublicRoute` before the login page ever
 * mounts, and fixing only the page would leave that path broken.
 */
export function resolvePostAuthDestination(
  user: User | null | undefined,
  rawRedirect: string | null | undefined,
  origin?: string,
): string {
  const base = resolvePostAuthPath(user);
  if (base === "/onboarding") return base;
  return resolveSafeRedirect(rawRedirect, origin) ?? base;
}
