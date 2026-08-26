/**
 * Fix 1 — the redundant post-onboarding Profile Setup wizard is gone, and the
 * canonical onboarding flow is not.
 *
 * `ProfileSetupModal` was a SECOND wizard mounted inside `ProtectedRoute`, i.e.
 * DOWNSTREAM of the canonical `needsAppOnboardingWizard()` gate. It re-prompted a
 * user who had already finished `/onboarding` whenever an optional profile field
 * (phone, resident state) was blank, and again every 3 days after a skip, driven by
 * an `agentflow-profile-setup-<uid>` localStorage entry.
 *
 * This is a source audit (same pattern as `inboundBrowserLifecycleWrites.test.ts`)
 * so a future edit cannot quietly reintroduce the modal, its context callbacks, or
 * the localStorage key. The behavioural half lives in `protectedRouteOnboarding`.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "../..");
const APP = join(SRC, "App.tsx");
const AUTH_CONTEXT = join(SRC, "contexts/AuthContext.tsx");
const PROTECTED_ROUTE = join(SRC, "components/auth/ProtectedRoute.tsx");
const PROFILE_SETUP_MODAL = join(SRC, "components/onboarding/ProfileSetupModal.tsx");

/** Every retired token. None may survive anywhere under `src/`. */
const RETIRED_TOKENS = [
  "ProfileSetupModal",
  "checkProfileSetupNeeded",
  "markProfileSetupSeen",
  "agentflow-profile-setup",
] as const;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Test files are excluded from the sweep: this audit names every retired token by
 * definition, and `protectedRouteOnboarding.test.tsx` deliberately reimplements the
 * retired callbacks in its auth mock in order to prove `ProtectedRoute` never calls
 * them. The sweep targets SHIPPED source, which is where a reintroduction would matter.
 */
const isTestFile = (file: string) => /(^|\/)__tests__(\/|$)/.test(file) || /\.(test|spec)\.tsx?$/.test(file);

describe("Fix 1 — the redundant profile-setup wizard is fully removed", () => {
  it("App.tsx neither imports nor mounts ProfileSetupModal", () => {
    const src = readFileSync(APP, "utf8");
    expect(src).not.toMatch(/ProfileSetupModal/);
    expect(src).not.toMatch(/<ProfileSetupModal/);
  });

  it("App.tsx no longer reads the profile-setup context callbacks", () => {
    const src = readFileSync(APP, "utf8");
    expect(src).not.toMatch(/checkProfileSetupNeeded/);
    expect(src).not.toMatch(/markProfileSetupSeen/);
  });

  it("AuthContext exposes no profile-setup callbacks and touches no profile-setup storage key", () => {
    const src = readFileSync(AUTH_CONTEXT, "utf8");
    expect(src).not.toMatch(/checkProfileSetupNeeded/);
    expect(src).not.toMatch(/markProfileSetupSeen/);
    expect(src).not.toMatch(/agentflow-profile-setup/);
  });

  it("the ProfileSetupModal component file is deleted", () => {
    expect(existsSync(PROFILE_SETUP_MODAL)).toBe(false);
  });

  it("no shipped source file under src/ still references any retired profile-setup token", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      if (isTestFile(file)) continue;
      const src = readFileSync(file, "utf8");
      for (const token of RETIRED_TOKENS) {
        if (src.includes(token)) offenders.push(`${file} :: ${token}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("Fix 1 — the canonical onboarding flow is preserved", () => {
  it("the canonical gate helper still exists and is still exported", () => {
    const src = readFileSync(join(SRC, "lib/onboarding-wizard.ts"), "utf8");
    expect(src).toMatch(/export function needsAppOnboardingWizard/);
  });

  it("App.tsx still routes /onboarding through OnboardingRouteGate", () => {
    const src = readFileSync(APP, "utf8");
    expect(src).toMatch(/path="\/onboarding"/);
    expect(src).toMatch(/<OnboardingRouteGate\s*\/>/);
  });

  it("the onboarding route gate still fires the one-time welcome-email trigger", () => {
    const src = readFileSync(APP, "utf8");
    const gate = src.slice(src.indexOf("const OnboardingRouteGate"), src.indexOf("const ProtectedRoute"));
    expect(gate).toMatch(/useWelcomeEmailTrigger\(\)/);
  });

  it("ProtectedRoute still redirects an unfinished user to /onboarding, carrying the origin", () => {
    const src = readFileSync(PROTECTED_ROUTE, "utf8");
    expect(src).toMatch(/needsAppOnboardingWizard\(user\)/);
    expect(src).toMatch(/to="\/onboarding"/);
    expect(src).toMatch(/state=\{\{\s*from:\s*location\.pathname\s*\}\}/);
  });

  it("ProtectedRoute keeps its unauthenticated and loading branches", () => {
    const src = readFileSync(PROTECTED_ROUTE, "utf8");
    expect(src).toMatch(/to="\/login"/);
    expect(src).toMatch(/isLoading \|\| isBuildingOrganization/);
  });
});
