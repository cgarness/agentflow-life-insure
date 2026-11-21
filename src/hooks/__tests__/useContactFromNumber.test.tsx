import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useContactFromNumber } from "@/hooks/useContactFromNumber";
import type { ContactNumberAffinity, ContactNumberOption } from "@/lib/number-affinity";

const api = vi.hoisted(() => ({ options: vi.fn(), change: vi.fn() }));
vi.mock("@/lib/number-affinity", () => ({ contactNumberOptions: api.options, changeContactNumber: api.change }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "agent-a" },
  profile: { id: "agent-a", organization_id: "agency-a" }, isImpersonating: false }) }));

type Props = Parameters<typeof useContactFromNumber>[0];
const first: ContactNumberOption = { id: "10000000-0000-4000-8000-000000000001", number: "+12135550101",
  readiness: "ready", voice_readiness: "ready", provisional: true, state: "established", version: 1 };
const alternate: ContactNumberOption = { ...first, id: "10000000-0000-4000-8000-000000000002", number: "+12135550102" };
const preview: ContactNumberAffinity = { voice_mode: "enforced", sms_mode: "enforced", generation: 1,
  history: "reconciled", voice: first, sms: first };
function props(data: ContactNumberAffinity | undefined = preview,
  overrides: { data?: ContactNumberAffinity; isPending?: boolean; isError?: boolean } = {}): Props {
  return { phone: "+13105550100", canAssign: true, legacyNumber: "+12135550999",
    model: { contactId: "contact-a", type: "lead", data, dataUpdatedAt: 1, isPending: false, isError: false,
      readOnly: false, sender: data?.sms, canText: !!data, override: null,
      refetch: vi.fn(), refresh: vi.fn(), acceptPreview: vi.fn(), ...overrides } as unknown as Props["model"] };
}
beforeEach(() => { vi.resetAllMocks(); api.options.mockResolvedValue([first, alternate]); });
afterEach(cleanup);

describe("contact FROM action ownership and readiness", () => {
  it.each(["pending", "missing", "error"])("blocks actions instead of using the legacy caller for an %s preview", async state => {
    const input = props(state === "error" ? preview : undefined, {
      data: state === "error" ? preview : undefined, isPending: state === "pending", isError: state === "error",
    });
    const { result } = renderHook(() => useContactFromNumber(input));
    await act(async () => {});
    expect(result.current.canCall).toBe(false);
    expect(result.current.canText).toBe(false);
    expect(result.current.captureCallSelection()).toBeNull();
  });

  it("preserves the legacy caller only after a known off-mode preview", async () => {
    const { result } = renderHook(() => useContactFromNumber(props({ ...preview, voice_mode: "off", sms_mode: "off" })));
    await act(async () => {});
    expect(api.options).not.toHaveBeenCalled();
    expect(result.current.captureCallSelection()).toEqual({ fromNumber: "+12135550999" });
  });

  it("does not turn an untouched first sender into an override", async () => {
    const unassigned = { ...first, state: "unassigned", version: 0 };
    const { result } = renderHook(() => useContactFromNumber(props({ ...preview, history: "new", voice: unassigned, sms: unassigned })));
    await waitFor(() => expect(result.current.canCall).toBe(true));
    expect(result.current.temporary).toBe(false);
    expect(result.current.smsSelection).toEqual({ senderPreference: first.number, expectedSenderId: first.id, overrideSenderId: null });
    expect(result.current.captureCallSelection()).toMatchObject({ fromNumber: first.number, expectedCallerNumber: first.number });
    expect(result.current.captureCallSelection()).not.toHaveProperty("oneCallNumberId");
  });

  it("refreshes temporary readiness without changing intent, assignment or re-sending", async () => {
    api.options.mockResolvedValue([first, { ...alternate, readiness: "setting_up_texting" }]);
    const input = props();
    const { result, rerender } = renderHook((value: Props) => useContactFromNumber(value), { initialProps: input });
    await waitFor(() => expect(result.current.canCall).toBe(true));
    act(() => result.current.select(alternate.id!));
    await act(() => result.current.confirm(false));
    expect(result.current.canCall).toBe(true);
    expect(result.current.canText).toBe(false);
    expect(result.current.smsSelection.overrideSenderId).toBe(alternate.id);
    const captured = result.current.captureCallSelection();

    api.options.mockResolvedValue([first, alternate]);
    rerender({ ...input, model: { ...input.model, dataUpdatedAt: 2 } });
    await waitFor(() => expect(result.current.canText).toBe(true));
    expect(result.current.sender?.id).toBe(alternate.id);
    expect(result.current.preview).toEqual(preview);

    api.options.mockResolvedValue([first, { ...alternate, readiness: "texting_paused", voice_readiness: "daily_limit" }]);
    rerender({ ...input, model: { ...input.model, dataUpdatedAt: 3 } });
    await waitFor(() => expect(result.current.canCall).toBe(false));
    expect(result.current.canText).toBe(false);
    expect(captured && "isSelectionCurrent" in captured && captured.isSelectionCurrent?.()).toBe(false);
    expect(result.current.sender?.id).toBe(alternate.id);
    expect(result.current.smsSelection.overrideSenderId).toBe(alternate.id);
    expect(api.change).not.toHaveBeenCalled();
  });

  it("rechecks pending-choice readiness before allowing a permanent assignment", async () => {
    const input = props();
    const { result, rerender } = renderHook((value: Props) => useContactFromNumber(value), { initialProps: input });
    await waitFor(() => expect(result.current.canCall).toBe(true));
    act(() => result.current.select(alternate.id!));
    api.options.mockResolvedValue([first, { ...alternate, readiness: "setup_required" }]);
    rerender({ ...input, model: { ...input.model, dataUpdatedAt: 2 } });
    await waitFor(() => expect(result.current.pending?.sender.readiness).toBe("setup_required"));
    await act(() => result.current.confirm(true));
    expect(api.change).not.toHaveBeenCalled();
    expect(result.current.error).toContain("ready for calls and texts");
    expect(result.current.sender?.id).toBe(first.id);
  });

  it("keeps a removed temporary number selected and blocks it instead of substituting a default", async () => {
    const input = props();
    const { result, rerender } = renderHook((value: Props) => useContactFromNumber(value), { initialProps: input });
    await waitFor(() => expect(result.current.canCall).toBe(true));
    act(() => result.current.select(alternate.id!));
    await act(() => result.current.confirm(false));
    api.options.mockResolvedValue([first]);
    rerender({ ...input, model: { ...input.model, dataUpdatedAt: 2 } });
    await waitFor(() => expect(result.current.canCall).toBe(false));
    expect(result.current.canText).toBe(false);
    expect(result.current.sender?.number).toBe(alternate.number);
    expect(result.current.smsSelection.expectedSenderId).toBe(alternate.id);
  });

  it("ignores an options response from the previous contact visit", async () => {
    let resolveOld!: (rows: ContactNumberOption[]) => void;
    api.options.mockImplementationOnce(() => new Promise<ContactNumberOption[]>(resolve => { resolveOld = resolve; }));
    const input = props();
    const { result, rerender } = renderHook((value: Props) => useContactFromNumber(value), { initialProps: input });
    rerender({ ...input, model: { ...input.model, contactId: "contact-b" } });
    await waitFor(() => expect(result.current.options).toHaveLength(2));
    await act(async () => resolveOld([{ ...alternate, number: "+12135550888" }]));
    expect(result.current.options).toEqual([first, alternate]);
  });
});
