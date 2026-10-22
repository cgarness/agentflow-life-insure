import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { OrganizationCarriers } from "@/hooks/useOrganizationCarriers";
import { installComboboxDomStubs, pickCarrier } from "@/test/carrierComboboxTestUtils";
const h = vi.hoisted(() => ({ save: vi.fn(), user: "agent", org: "org", list: null as unknown as OrganizationCarriers }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: h.user } }) }));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: h.org }) }));
vi.mock("@/hooks/useOrganizationCarriers", () => ({ useOrganizationCarriers: () => h.list }));
const ready = (carriers = ["Carrier", "Other Carrier"]): OrganizationCarriers => ({ status: "ready", carriers, retry: vi.fn() });
// Phase 2A: the modal saves through the commission companion; arguments are (attempt, requestId, clientId, policy, primary, commission).
vi.mock("@/lib/policySaleRecording", async importOriginal => ({ ...(await importOriginal<object>()), recordClientPolicyHandoff: h.save }));
// The commission preview needs a QueryClient this harness does not mount; policyCommissionPreviewModals covers it.
vi.mock("@/components/commission/preview/PolicyCommissionEstimate", () => ({ PolicyCommissionEstimate: () => null }));
import RecordPolicyModal from "../RecordPolicyModal";
afterEach(cleanup);
beforeEach(() => { h.save.mockReset(); h.user="agent"; h.org="org"; h.list=ready(); installComboboxDomStubs(); });
async function setup() {
  const close=vi.fn(), saved=vi.fn();
  const page=render(<RecordPolicyModal open clientId="client" onClose={close} onSaved={saved} />);
  await pickCarrier("Carrier");
  fireEvent.change(screen.getByLabelText("Sold Date"), {target:{value:"2026-09-28"}});
  return {page,close,saved,submit:()=>fireEvent.click(screen.getByRole("button",{name:"Record Policy"}))};
}
describe("record policy transaction", () => {
  it("retains the same policy request after a lost response and closes only on success", async () => {
    h.save.mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValue({});
    const s=await setup(); s.submit();
    await screen.findByText("Connection lost");
    expect(s.close).not.toHaveBeenCalled(); s.submit();
    await waitFor(()=>expect(s.saved).toHaveBeenCalledTimes(1));
    expect(h.save.mock.calls[0][1]).toBe(h.save.mock.calls[1][1]);
    expect(h.save.mock.calls[0][3]).toMatchObject({premium:null,sale_mode:"new"});
  });
  it("preserves cents and explicit historical intent", async () => {
    h.save.mockResolvedValue({}); const s=await setup();
    fireEvent.change(screen.getByLabelText("Monthly premium"), {target:{value:"$58.45"}});
    fireEvent.click(screen.getByRole("checkbox")); s.submit();
    await waitFor(()=>expect(s.saved).toHaveBeenCalled());
    expect(h.save.mock.calls[0][3]).toMatchObject({premium:58.45,sale_mode:"historical",sold_date:"2026-09-28"});
  });
  it("rejects malformed premium without persistence", async () => {
    const s=await setup(); fireEvent.change(screen.getByLabelText("Monthly premium"),{target:{value:"$50 garbage"}});s.submit();
    await screen.findByRole("alert"); expect(h.save).not.toHaveBeenCalled();
  });
  it("discards a successful response after an agency switch", async () => {
    let finish!:()=>void; h.save.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));
    const s=await setup();s.submit();h.org="other";
    s.page.rerender(<RecordPolicyModal open clientId="client" onClose={s.close} onSaved={s.saved} />);
    finish();await waitFor(()=>expect(screen.getByRole("button",{name:"Record Policy"})).toBeEnabled());
    expect(s.saved).not.toHaveBeenCalled();expect(s.close).not.toHaveBeenCalled();
  });
});

describe("record policy carrier selection", () => {
  it("never auto-selects, blocks a save without a carrier and saves the exact picked carrier", async () => {
    h.list = ready(["Only Carrier"]); h.save.mockResolvedValue({});
    const saved = vi.fn();
    render(<RecordPolicyModal open clientId="client" onClose={vi.fn()} onSaved={saved} />);
    expect(screen.getByLabelText("Carrier")).toHaveTextContent("Select carrier…");
    fireEvent.change(screen.getByLabelText("Sold Date"), { target: { value: "2026-09-28" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Policy" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Carrier is required");
    expect(h.save).not.toHaveBeenCalled();
    await pickCarrier("Only Carrier");
    fireEvent.click(screen.getByRole("button", { name: "Record Policy" }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(h.save.mock.calls[0][3]).toMatchObject({ carrier: "Only Carrier" });
  });
  it("rejects a carrier when the list is not loaded for the current agency", async () => {
    const s = await setup();
    h.list = { status: "loading", carriers: null, retry: vi.fn() };
    s.page.rerender(<RecordPolicyModal open clientId="client" onClose={s.close} onSaved={s.saved} />);
    s.submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Carriers haven't loaded yet");
    expect(h.save).not.toHaveBeenCalled();
  });
  it.each([
    ["fails to load", { status: "error", carriers: null }],
    ["is loading", { status: "loading", carriers: null }],
    ["no longer has the carrier", { status: "ready", carriers: ["Other Carrier"] }],
  ] as const)("retries a frozen sale unchanged when the carrier list %s", async (_case, next) => {
    const prepared = { frozen: "submission" };
    h.save.mockImplementationOnce(async (attempt: { sent: boolean; prepared: unknown }) => {
      attempt.sent = true; attempt.prepared = prepared; throw new Error("Connection lost");
    }).mockResolvedValue({});
    const s = await setup(); s.submit();
    await screen.findByText(/Connection lost/);
    h.list = { ...next, carriers: next.carriers ? [...next.carriers] : null, retry: vi.fn() };
    s.page.rerender(<RecordPolicyModal open clientId="client" onClose={s.close} onSaved={s.saved} />);
    expect(screen.getByLabelText("Carrier")).toBeDisabled();
    s.submit();
    await waitFor(() => expect(s.saved).toHaveBeenCalledTimes(1));
    expect(h.save).toHaveBeenCalledTimes(2);
    expect(h.save.mock.calls[1][0].frozen).toBe(prepared);
    expect(h.save.mock.calls[1][1]).toBe(h.save.mock.calls[0][1]);
    expect(h.save.mock.calls[1][3]).toEqual(h.save.mock.calls[0][3]);
  });
  it("disables the picker and closes an open dropdown while saving", async () => {
    let finish!: () => void; h.save.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const s = await setup();
    fireEvent.click(screen.getByLabelText("Carrier"));
    expect(await screen.findByRole("option", { name: "Other Carrier" })).toBeInTheDocument();
    // The open (modal) dropdown hides the rest of the dialog from the accessibility tree: lock the form directly.
    fireEvent.submit(s.page.baseElement.querySelector("form")!);
    await waitFor(() => expect(h.save).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("option", { name: "Other Carrier" })).not.toBeInTheDocument());
    expect(screen.getByLabelText("Carrier")).toBeDisabled();
    finish(); await waitFor(() => expect(s.saved).toHaveBeenCalled());
  });
});
