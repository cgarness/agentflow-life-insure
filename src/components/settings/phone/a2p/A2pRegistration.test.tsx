import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import A2pRegistration from "./A2pRegistration";
import { A2pPreparation } from "./A2pPreparation";
import { A2pStatus } from "./A2pStatus";
import A2pSession from "./A2pSession";
import { useA2pRegistration } from "./useA2pRegistration";
import { emptyDraft, type Overview } from "./types";
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  auth: {
    user: { id: "admin" },
    realProfile: { id: "admin", organization_id: "org", role: "Admin", status: "Active" },
    isImpersonating: false,
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: mocks.invoke } } }));
vi.mock(
  "@twilio/twilio-compliance-embed",
  () => ({
    TwilioComplianceEmbed: (
      { onInquirySubmitted, onError }: { onInquirySubmitted: () => void; onError: () => void },
    ) => (
      <div>
        <button onClick={onInquirySubmitted}>Test complete hosted form</button>
        <button onClick={onError}>Test expired session</button>
      </div>
    ),
  }),
);
function overview(): Overview {
  return {
    registration: {
      draft: { ...emptyDraft, businessName: "Test agency" },
      version: 1,
      brand_status: "draft",
      identity_status: null,
      brand_errors: [],
      campaign_status: "not_started",
      campaign_errors: [],
      is_test: false,
      last_synced_at: new Date().toISOString(),
      sync_error: null,
      operation_pending: false,
    },
    setup_ready: true,
    account_enabled: true,
    sms_enforced: true,
    fees: [{ label: "Fixture fee", amount: "Test only" }],
    fee_version: "test-v1",
    fees_valid_until: "2099-01-01",
    phones: [{ id: "phone", phone_number: "+14155551234", status: "active", assignment_type: "agency" }],
    numbers: [],
    history: [],
  };
}
beforeEach(() => {
  mocks.auth.isImpersonating = false;
  mocks.auth.realProfile.role = "Admin";
  mocks.invoke.mockReset().mockResolvedValue({ data: overview(), error: null });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe("A2P agency admin flow", () => {
  it("blocks View As and non-admin without making a request", () => {
    mocks.auth.isImpersonating = true;
    const v = render(<A2pRegistration />);
    expect(screen.getByText(/Exit View As/)).toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalled();
    mocks.auth.isImpersonating = false;
    mocks.auth.realProfile.role = "Agent";
    v.rerender(<A2pRegistration />);
    expect(screen.getByText(/Agency administrator access/)).toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("loads under StrictMode and scopes every request to the real actor and agency", async () => {
    render(
      <StrictMode>
        <A2pRegistration />
      </StrictMode>,
    );
    await screen.findByText("Prepare your registration");
    expect(mocks.invoke).toHaveBeenCalledWith("a2p-registration", {
      body: { action: "overview", actor_id: "admin", organization_id: "org" },
    });
    expect(screen.getByRole("button", { name: "Resume / correct business registration" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Resume / correct business registration" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Register messaging campaign" })).toBeDisabled();
  });
  it("shows missing account setup, allows preparation and prevents paid actions", async () => {
    const d = overview();
    d.setup_ready = false;
    mocks.invoke.mockResolvedValue({ data: d, error: null });
    render(<A2pRegistration />);
    await screen.findByText("Account setup required");
    expect(screen.getByRole("button", { name: "Save preparation" })).toBeEnabled();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Resume / correct business registration" })).toBeDisabled();
  });
  it("shows service errors with a retry, never an empty success screen", async () => {
    mocks.invoke.mockResolvedValueOnce({
      data: null,
      error: { context: { json: async () => ({ error: "Setup unavailable" }) } },
    });
    render(<A2pRegistration />);
    await screen.findByRole("alert");
    expect(screen.getByText("Setup unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Prepare your registration");
  });
  it("shows provider correction details and history after rejection", () => {
    const d = overview();
    d.registration!.campaign_status = "FAILED";
    d.registration!.campaign_errors = [{ code: "30909", message: "Opt-in evidence must be accessible." }];
    d.history = [{
      id: "h",
      kind: "provider_status",
      detail: { brand_status: "APPROVED", campaign_status: "FAILED" },
      created_at: "2026-01-01",
    }];
    render(<A2pStatus data={d} busy={false} attach={vi.fn()} />);
    expect(screen.getByText(/Opt-in evidence must be accessible/)).toBeInTheDocument();
    expect(screen.getByText("Campaign review needs attention")).toBeInTheDocument();
    expect(screen.getByText("Provider review status updated")).toBeInTheDocument();
    expect(screen.queryByText("Ready to text")).not.toBeInTheDocument();
  });
  it("requires brand identity, campaign, signed number, membership, current sync and active account for readiness", () => {
    const d = overview();
    Object.assign(d.registration!, {
      brand_status: "APPROVED",
      identity_status: "VERIFIED",
      campaign_status: "VERIFIED",
    });
    d.numbers = [{
      phone_number_id: "phone",
      status: "registered",
      pool_member: true,
      checked_at: new Date().toISOString(),
      failure_reason: null,
    }];
    const view = render(<A2pStatus data={d} busy={false} attach={vi.fn()} />);
    expect(screen.getByText("Ready to text")).toBeInTheDocument();
    for (const change of ["pending", "removed", "stale", "test", "identity", "account"]) {
      const next = structuredClone(d);
      if (change === "pending") next.numbers[0].status = "pending_registration";
      if (change === "removed") next.numbers[0].pool_member = false;
      if (change === "stale") next.registration!.last_synced_at = "2000-01-01";
      if (change === "test") next.registration!.is_test = true;
      if (change === "identity") next.registration!.identity_status = "UNVERIFIED";
      if (change === "account") next.account_enabled = false;
      view.rerender(<A2pStatus data={next} busy={false} attach={vi.fn()} />);
      expect(screen.queryByText("Ready to text")).not.toBeInTheDocument();
    }
  });
  it("keeps incomplete number links retryable without claiming registration", () => {
    const d = overview();
    Object.assign(d.registration!, {
      brand_status: "APPROVED",
      identity_status: "VERIFIED",
      campaign_status: "VERIFIED",
    });
    d.numbers = [{
      phone_number_id: "phone",
      status: "pending_registration",
      pool_member: false,
      checked_at: null,
      failure_reason: null,
    }];
    const attach = vi.fn();
    render(<A2pStatus data={d} busy={false} attach={attach} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry number link" }));
    expect(attach).toHaveBeenCalledWith("phone");
    expect(screen.queryByText("Ready to text")).not.toBeInTheDocument();
  });
  it("validates preparation before saving and retains its version after concurrent refresh", async () => {
    const save = vi.fn().mockResolvedValue(null);
    const view = render(<A2pPreparation initialVersion={1} busy={false} onSave={save} />);
    fireEvent.click(screen.getByRole("button", { name: "Save preparation" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Legal business name"), { target: { value: "Unsaved agency" } });
    view.rerender(
      <A2pPreparation
        initial={{ ...emptyDraft, businessName: "Remote edit" }}
        initialVersion={2}
        busy={false}
        onSave={save}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save preparation" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ businessName: "Unsaved agency" }), 1)
    );
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });
  it("hosted completion is submission acknowledgement, not approval; expired sessions recover", () => {
    const close = vi.fn();
    render(<A2pSession session={{ stage: "brand", sessionId: "inq_test", sessionToken: "test" }} onClose={close} />);
    fireEvent.click(screen.getByRole("button", { name: "Test complete hosted form" }));
    expect(screen.getByText(/Form completed/)).toBeInTheDocument();
    expect(screen.queryByText("Approved")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Test expired session" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/session expired/);
    fireEvent.click(screen.getByRole("button", { name: "Close and refresh status" }));
    expect(close).toHaveBeenCalledOnce();
  });
  it("retains operation warning after uncertain provider result", async () => {
    const d = overview();
    d.registration!.operation_pending = true;
    mocks.invoke.mockResolvedValue({ data: d, error: null });
    render(<A2pRegistration />);
    await screen.findByText(/result needs reconciliation/);
    expect(screen.getByRole("button", { name: "Resume / correct business registration" })).toBeDisabled();
  });
  it("ignores an old agency response after scope changes", async () => {
    let finish: (value: unknown) => void = () => {};
    mocks.invoke.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { result, rerender } = renderHook(({ org }) => useA2pRegistration("admin", org), {
      initialProps: { org: "old" },
    });
    rerender({ org: "new" });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    const old = overview();
    old.registration!.draft.businessName = "Old agency";
    await act(async () => finish({ data: old, error: null }));
    expect(result.current.data!.registration!.draft.businessName).toBe("Test agency");
  });
  it("updates decisions in an open tab without opening a provider session", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useA2pRegistration("admin", "org"));
    await act(async () => {});
    const d = overview();
    d.registration!.campaign_status = "FAILED";
    mocks.invoke.mockResolvedValue({ data: d, error: null });
    await act(async () => vi.advanceTimersByTime(60000));
    expect(result.current.data!.registration!.campaign_status).toBe("FAILED");
    expect(mocks.invoke.mock.calls.at(-1)?.[1].body.action).toBe("overview");
  });
});
