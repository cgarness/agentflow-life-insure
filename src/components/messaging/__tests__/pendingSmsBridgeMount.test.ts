/**
 * Source audit (same pattern as `profileSetupWizardRemoval.test.ts`): `App.tsx` mounts the
 * pending-SMS authority bridge exactly once, inside `AuthProvider` and outside the router, so
 * sign-out, a user change and View As clear pending SMS even when no SMS surface is mounted.
 * The bridge's behaviour is covered in `src/lib/sms-send/__tests__`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const APP = readFileSync(resolve(__dirname, "../../../App.tsx"), "utf8");
const at = (token: string) => APP.indexOf(token);

describe("App mounts the pending-SMS authority bridge", () => {
  it("imports it from the messaging components", () => {
    expect(APP).toMatch(/import \{ PendingSmsAuthorityBridge \} from "@\/components\/messaging\/PendingSmsAuthorityBridge";/);
  });

  it("renders it exactly once", () => {
    expect(APP.match(/<PendingSmsAuthorityBridge\s*\/>/g) ?? []).toHaveLength(1);
  });

  it("renders it inside AuthProvider and outside the router", () => {
    const bridge = at("<PendingSmsAuthorityBridge");
    expect(at("<AuthProvider>")).toBeGreaterThan(-1);
    expect(bridge).toBeGreaterThan(at("<AuthProvider>"));
    expect(bridge).toBeLessThan(at("</AuthProvider>"));
    expect(bridge).toBeLessThan(at("<BrowserRouter>"));
  });
});
