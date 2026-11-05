import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Reports V2 telephony boundary (D3 §4 and §7, D4 §4, A-§7).
 * - TwilioContext is never edited by PKG-C or PKG-D. It is pinned to its bytes on origin/main 09ec29a4 (PR #515's
 *   re-entrancy and single-leg Voice.js changes; the integration branch carries main's file unchanged).
 * - DialerPage carries exactly the approved PKG-C clause A-§7(a): `sourceCallId={currentCallId}` on the existing
 *   ConvertLeadModal mount, and nothing else from Reports V2. A clause check, not a whole-file hash, so unrelated main
 *   changes (such as the one-line hasDraft change) do not trip it.
 * - DialerPage also carries exactly the approved PKG-D clause A-§7(b): `type: data.type,` in the appointment save call.
 */
const ROOT = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

const TWILIO_CONTEXT_MAIN = "4a567164f27bb8661918b93a2d7a1569f15ec96065158406f296612937ef356a";

describe("Reports V2 telephony boundary", () => {
  it("TwilioContext.tsx is byte-identical to main", () => {
    expect(sha256(read("src/contexts/TwilioContext.tsx"))).toBe(TWILIO_CONTEXT_MAIN);
  });

  it("DialerPage carries exactly clause (a): sourceCallId={currentCallId} on the ConvertLeadModal mount", () => {
    const source = read("src/pages/DialerPage.tsx");
    const mount = source.match(/<ConvertLeadModal\b[\s\S]*?\/>/g) ?? [];
    expect(mount).toHaveLength(1);
    const props = mount[0].split("\n").slice(1, -1).map((line) => line.trim().split("=")[0]);
    expect(props).toEqual(["open", "onClose", "lead", "onSuccess", "campaignId", "sourceCallId"]);
    expect(mount[0]).toContain("\n        sourceCallId={currentCallId}\n");
    expect(source.match(/sourceCallId/g)).toHaveLength(1);
    expect(source).not.toMatch(/SaleSourceCallChip|TrackedCallObserver|policy_sale_call_link|_handoff_v2|recentTrackedCall/);
  });

  it("FloatingDialer passes only the call-context props", () => {
    const source = read("src/components/layout/FloatingDialer.tsx");
    expect(source.match(/sourceCallId=/g)).toHaveLength(2);
    expect(source).toContain("\n        sourceCallId={policyClient.callId}\n");
    expect(source).toContain("\n        sourceCallId={pendingConversion?.callId ?? null}\n");
    expect(source).not.toMatch(/SaleSourceCallChip|TrackedCallObserver|policy_sale_call_link|_handoff_v2|recentTrackedCall/);
  });

  it("DialerPage carries exactly clause (b): the AppointmentModal save passes type: data.type, and nothing else does", () => {
    const page = read("src/pages/DialerPage.tsx");
    expect(page.match(/type: data\.type,/g)).toHaveLength(1);
    const call = page.slice(page.indexOf("await saveAppointment({ request_id: data.booking_request_id!"));
    const body = call.slice(0, call.indexOf("}, organizationId);"));
    expect(body).toContain("type: data.type,");
    expect(page).not.toMatch(/ClosingAppointmentField|AppointmentOutcomePanel|PolicyLinkPrompt|policy_appointment|appointmentLinkRetry/);
  });
});
