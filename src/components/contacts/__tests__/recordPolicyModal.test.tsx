import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const h = vi.hoisted(() => ({ save: vi.fn(), user: "agent", org: "org" }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: h.user } }) }));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: h.org }) }));
vi.mock("@/lib/policySaleRecording", async importOriginal => ({ ...(await importOriginal<object>()), recordClientPolicy: h.save }));
import RecordPolicyModal from "../RecordPolicyModal";
afterEach(cleanup);
beforeEach(() => { h.save.mockReset(); h.user="agent"; h.org="org"; });
function setup() {
  const close=vi.fn(), saved=vi.fn();
  const page=render(<RecordPolicyModal open clientId="client" onClose={close} onSaved={saved} />);
  fireEvent.change(screen.getByLabelText("Carrier"), {target:{value:"Carrier"}});
  fireEvent.change(screen.getByLabelText("Sold Date"), {target:{value:"2026-09-28"}});
  return {page,close,saved,submit:()=>fireEvent.click(screen.getByRole("button",{name:"Record Policy"}))};
}
describe("record policy transaction", () => {
  it("retains the same policy request after a lost response and closes only on success", async () => {
    h.save.mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValue({});
    const s=setup(); s.submit();
    await screen.findByText("Connection lost");
    expect(s.close).not.toHaveBeenCalled(); s.submit();
    await waitFor(()=>expect(s.saved).toHaveBeenCalledTimes(1));
    expect(h.save.mock.calls[0][0]).toBe(h.save.mock.calls[1][0]);
    expect(h.save.mock.calls[0][2]).toMatchObject({premium:null,sale_mode:"new"});
  });
  it("preserves cents and explicit historical intent", async () => {
    h.save.mockResolvedValue({}); const s=setup();
    fireEvent.change(screen.getByLabelText("Monthly premium"), {target:{value:"$58.45"}});
    fireEvent.click(screen.getByRole("checkbox")); s.submit();
    await waitFor(()=>expect(s.saved).toHaveBeenCalled());
    expect(h.save.mock.calls[0][2]).toMatchObject({premium:58.45,sale_mode:"historical",sold_date:"2026-09-28"});
  });
  it("rejects malformed premium without persistence", async () => {
    const s=setup(); fireEvent.change(screen.getByLabelText("Monthly premium"),{target:{value:"$50 garbage"}});s.submit();
    await screen.findByRole("alert"); expect(h.save).not.toHaveBeenCalled();
  });
  it("discards a successful response after an agency switch", async () => {
    let finish!:()=>void; h.save.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));
    const s=setup();s.submit();h.org="other";
    s.page.rerender(<RecordPolicyModal open clientId="client" onClose={s.close} onSaved={s.saved} />);
    finish();await waitFor(()=>expect(screen.getByRole("button",{name:"Record Policy"})).toBeEnabled());
    expect(s.saved).not.toHaveBeenCalled();expect(s.close).not.toHaveBeenCalled();
  });
});
