/**
 * Corrective pass, defect 6 — the profile inbound card's activation banner is gated by the ACTIVE engine and
 * never claims "legacy" when the engine is merely unknown.
 */
import React from "react";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const agent = vi.hoisted(() => ({ engine: "legacy" as string, activationPending: true }));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" }, realProfile: { id: "u1", organization_id: "org-1" }, isImpersonating: false }),
}));
vi.mock("@/contexts/AgentStatusContext", () => ({
  useAgentStatus: () => ({ activationPending: agent.activationPending, engine: agent.engine }),
}));
vi.mock("@/integrations/supabase/client", () => {
  const b: Record<string, unknown> = {};
  const self = () => b;
  b.select = self; b.eq = self; b.upsert = self;
  b.maybeSingle = async () => ({ data: { mobile_forward_number: "+15551234567", mobile_forward_enabled: true, voicemail_greeting_text: "", voicemail_greeting_url: "" }, error: null });
  return { supabase: { from: () => b } };
});

import { ProfileInboundCard } from "@/components/settings/profile/ProfileInboundCard";

beforeEach(() => { agent.engine = "legacy"; agent.activationPending = true; });
afterEach(cleanup);

describe("ProfileInboundCard — activation banner", () => {
  it("legacy engine: the banner says the LEGACY engine does not use these settings", async () => {
    render(<ProfileInboundCard />);
    await waitFor(() => expect(screen.getByLabelText(/mobile number/i)).toBeTruthy());
    const banner = screen.getByTestId("inbound-pending-activation");
    expect(banner.getAttribute("data-engine")).toBe("legacy");
    expect(banner.textContent).toMatch(/legacy inbound routing engine/i);
  });

  it("unknown engine: the banner says the engine could NOT be confirmed — it never asserts legacy", async () => {
    agent.engine = "unknown";
    render(<ProfileInboundCard />);
    await waitFor(() => expect(screen.getByLabelText(/mobile number/i)).toBeTruthy());
    const banner = screen.getByTestId("inbound-pending-activation");
    expect(banner.getAttribute("data-engine")).toBe("unknown");
    expect(banner.textContent).toMatch(/could not be confirmed/i);
    expect(banner.textContent).not.toMatch(/still runs the legacy/i);
  });

  it("v2 active: no banner", async () => {
    agent.engine = "v2"; agent.activationPending = false;
    render(<ProfileInboundCard />);
    await waitFor(() => expect(screen.getByLabelText(/mobile number/i)).toBeTruthy());
    expect(screen.queryByTestId("inbound-pending-activation")).toBeNull();
  });
});
