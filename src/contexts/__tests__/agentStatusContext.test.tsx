// Corrective pass, defect 6 — availability is TRUTHFUL: a stored Offline is shown as such (the v2 engine
// skips that agent's browser), and the picker says whether the active engine enforces availability at
// all (legacy = pending activation).
import React from "react";
import { cleanup, render, screen, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LABEL_STORED_OFFLINE, LABEL_PHONE_DISCONNECTED, announceRoutingEngine, describeAvailabilityEffect, deriveEffectiveAvailability, normalizeStoredAvailability } from "@/lib/agentAvailability";

const auth = vi.hoisted(() => ({ availability: "Offline", updateProfile: vi.fn(), isImpersonating: false }));
const twilio = vi.hoisted(() => ({ status: "ready", callState: "idle" }));
const db = vi.hoisted(() => ({ engine: "legacy" as string | null, error: null as null | { message: string }, reads: 0 }));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    realProfile: { id: "u1", organization_id: "org-1", availability_status: auth.availability },
    updateProfile: auth.updateProfile,
    isImpersonating: auth.isImpersonating,
  }),
}));
vi.mock("@/contexts/TwilioContext", () => ({ useTwilio: () => ({ status: twilio.status, callState: twilio.callState }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => { db.reads += 1; return { data: db.engine === null ? null : { routing_engine: db.engine }, error: db.error }; } }) }) }),
  },
}));

import { AgentStatusProvider, useAgentStatus } from "@/contexts/AgentStatusContext";

const Probe: React.FC = () => {
  const s = useAgentStatus();
  return (
    <div>
      <span data-testid="stored">{s.stored}</span>
      <span data-testid="manual">{String(s.manual)}</span>
      <span data-testid="label">{s.effectiveLabel}</span>
      <span data-testid="engine">{s.engine}</span>
      <span data-testid="pending">{String(s.activationPending)}</span>
      <span data-testid="effect">{s.routingEffect}</span>
      <button onClick={() => void s.setAvailability("Available")}>go-available</button>
    </div>
  );
};

beforeEach(() => { auth.availability = "Offline"; auth.updateProfile.mockReset().mockResolvedValue(undefined); db.engine = "legacy"; db.error = null; db.reads = 0; twilio.status = "ready"; twilio.callState = "idle"; });
afterEach(cleanup);

describe("pure derivation", () => {
  it("a stored Offline is never mapped to Available and outranks the phone state; a disconnected phone shows as such", () => {
    expect(normalizeStoredAvailability("Offline")).toBe("Offline");
    expect(normalizeStoredAvailability("garbage")).toBe("Available");
    expect(deriveEffectiveAvailability({ stored: "Offline", phoneConnected: true, onCall: false })).toBe(LABEL_STORED_OFFLINE);
    expect(deriveEffectiveAvailability({ stored: "Available", phoneConnected: false, onCall: false })).toBe(LABEL_PHONE_DISCONNECTED);
    expect(deriveEffectiveAvailability({ stored: "Offline", phoneConnected: true, onCall: true })).toBe("On a Call");
  });
  it("legacy / unknown engines are PENDING ACTIVATION; v2 describes the real routing effect", () => {
    expect(describeAvailabilityEffect({ stored: "Do Not Disturb", engine: "legacy" }).activationPending).toBe(true);
    expect(describeAvailabilityEffect({ stored: "Available", engine: "unknown" }).activationPending).toBe(true);
    const v2 = describeAvailabilityEffect({ stored: "Offline", engine: "v2" });
    expect(v2.activationPending).toBe(false);
    expect(v2.routing).toContain("skip AgentFlow");
    expect(describeAvailabilityEffect({ stored: "On Break", engine: "v2" }).routing).toContain("voicemail");
  });
});

describe("AgentStatusProvider", () => {
  it("shows a stored Offline truthfully with no manual selection, and reports the legacy engine as pending activation", async () => {
    render(<AgentStatusProvider><Probe /></AgentStatusProvider>);
    await waitFor(() => expect(screen.getByTestId("engine")).toHaveTextContent("legacy"));
    expect(screen.getByTestId("stored")).toHaveTextContent("Offline");
    expect(screen.getByTestId("manual")).toHaveTextContent("null");
    expect(screen.getByTestId("label")).toHaveTextContent(LABEL_STORED_OFFLINE);
    expect(screen.getByTestId("pending")).toHaveTextContent("true");
    expect(screen.getByTestId("effect")).toHaveTextContent("Pending activation");
  });

  it("under v2 the stored value is enforced and the effect is described; a read error stays 'unknown' (still pending), never a guessed v2", async () => {
    db.engine = "v2"; auth.availability = "On Break";
    const view = render(<AgentStatusProvider><Probe /></AgentStatusProvider>);
    await waitFor(() => expect(screen.getByTestId("engine")).toHaveTextContent("v2"));
    expect(screen.getByTestId("pending")).toHaveTextContent("false");
    expect(screen.getByTestId("effect")).toHaveTextContent("voicemail");
    view.unmount();
    db.error = { message: "boom" };
    render(<AgentStatusProvider><Probe /></AgentStatusProvider>);
    await waitFor(() => expect(screen.getByTestId("engine")).toHaveTextContent("unknown"));
    expect(screen.getByTestId("pending")).toHaveTextContent("true");
  });

  it("choosing a manual state persists it on the REAL profile via updateProfile; nothing is written under View As", async () => {
    render(<AgentStatusProvider><Probe /></AgentStatusProvider>);
    await act(async () => { screen.getByText("go-available").click(); });
    await waitFor(() => expect(auth.updateProfile).toHaveBeenCalledWith({ availability_status: "Available" }));
    cleanup();
    auth.isImpersonating = true;
    render(<AgentStatusProvider><Probe /></AgentStatusProvider>);
    await act(async () => { screen.getByText("go-available").click(); });
    expect(auth.updateProfile).toHaveBeenCalledTimes(1);
    auth.isImpersonating = false;
  });
});

describe("the engine follows an activation / rollback made in the SAME session", () => {
  it("an announced engine change updates the surface without a reload; an unusable announcement re-reads", async () => {
    db.engine = "legacy";
    render(<AgentStatusProvider><Probe /></AgentStatusProvider>);
    await waitFor(() => expect(screen.getByTestId("engine").textContent).toBe("legacy"));
    expect(screen.getByTestId("pending").textContent).toBe("true");
    await act(async () => { announceRoutingEngine("v2"); });        // the admin card activated v2
    await waitFor(() => expect(screen.getByTestId("engine").textContent).toBe("v2"));
    expect(screen.getByTestId("pending").textContent).toBe("false");
    db.engine = "legacy";                                           // rolled back, announced as unknown ⇒ re-read
    await act(async () => { announceRoutingEngine("unknown"); });
    await waitFor(() => expect(screen.getByTestId("engine").textContent).toBe("legacy"));
  });

  it("a read that keeps failing is 'unknown' after bounded retries — never silently legacy or v2", async () => {
    db.error = { message: "permission denied" };
    render(<AgentStatusProvider><Probe /></AgentStatusProvider>);
    await waitFor(() => expect(db.reads).toBe(3), { timeout: 4_000 });          // three bounded attempts
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId("engine").textContent).toBe("unknown");
    expect(screen.getByTestId("pending").textContent).toBe("true");
    db.error = null; db.engine = "v2";
    await act(async () => { announceRoutingEngine("unknown"); });               // a later re-read recovers
    await waitFor(() => expect(screen.getByTestId("engine").textContent).toBe("v2"));
  }, 10_000);
});
