import type { PropsWithChildren } from "react";
import { ContactCallerRoutingContext, type ContactCallerRouting } from "@/contexts/ContactCallerRoutingContext";
import { LOCAL_PRESENCE_OPTION } from "@/lib/contact-from-number";
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

  const unassignedSender = { ...first, state: "unassigned", version: 0 };
  const unassigned = { ...preview, history: "new" as const, voice: unassignedSender, sms: unassignedSender };

  function routed(overrides: Partial<ContactCallerRouting> = {}) {
    const value: ContactCallerRouting = {
      resolveContactLocalCaller: vi.fn().mockResolvedValue(alternate.number),
      getContactCallerRole: () => "agency",
      ...overrides,
    };
    const wrapper = ({ children }: PropsWithChildren) =>
      <ContactCallerRoutingContext.Provider value={value}>{children}</ContactCallerRoutingContext.Provider>;
    return { wrapper, value };
  }

  it("uses the locally resolved caller and ordinary first SMS sender independently", async () => {
    const { wrapper, value } = routed();
    const { result } = renderHook(() => useContactFromNumber(props(unassigned)), { wrapper });
    await waitFor(() => expect(result.current.canCall).toBe(true));
    expect(result.current.automatic).toBe(true);
    expect(value.resolveContactLocalCaller).toHaveBeenCalledWith("+13105550100", [first.number, alternate.number]);
    expect(result.current.smsSelection).toEqual({ senderPreference: first.number, expectedSenderId: first.id, overrideSenderId: null });
    expect(result.current.captureCallSelection()).toMatchObject({ fromNumber: alternate.number, expectedCallerNumber: alternate.number });
    expect(result.current.captureCallSelection()).not.toHaveProperty("oneCallNumberId");
    expect(api.change).not.toHaveBeenCalled();
  });

  it("keeps a captured local caller valid through an equivalent options refresh, and invalidates a replaced row", async () => {
    const { wrapper, value } = routed();
    const input = props(unassigned);
    const { result, rerender } = renderHook((value: Props) => useContactFromNumber(value), { wrapper, initialProps: input });
    await waitFor(() => expect(result.current.canCall).toBe(true));
    const original = result.current.captureCallSelection();
    const isCurrent = original && "isSelectionCurrent" in original ? original.isSelectionCurrent : undefined;
    expect(isCurrent?.()).toBe(true);
    api.options.mockResolvedValue([{ ...alternate }, { ...first }]);
    await act(async () => rerender({ ...input, model: { ...input.model, dataUpdatedAt: 2 } }));
    expect(isCurrent?.()).toBe(true);
    expect(value.resolveContactLocalCaller).toHaveBeenCalledTimes(1);

    const replacement = { ...alternate, id: "20000000-0000-4000-8000-000000000003" };
    api.options.mockResolvedValue([first, replacement]);
    await act(async () => rerender({ ...input, model: { ...input.model, dataUpdatedAt: 3 } }));
    expect(isCurrent?.()).toBe(false);
    expect(value.resolveContactLocalCaller).toHaveBeenCalledTimes(2);
  });

  it.each([["off", "off"], ["shadow", "shadow"], ["enforced", "off"], ["shadow", "enforced"]] as const)(
    "allows verified unassigned selection with voice mode %s and SMS mode %s", async (voice_mode, sms_mode) => {
      const { wrapper } = routed({ getContactCallerRole: () => "personal" });
      const { result } = renderHook(() => useContactFromNumber(props({ ...unassigned, voice_mode, sms_mode })), { wrapper });
      await waitFor(() => expect(result.current.canCall).toBe(true));
      expect(result.current.automatic).toBe(true);
      expect(result.current.smsSelection).toMatchObject({ expectedSenderId: first.id, overrideSenderId: null });
      act(() => result.current.select(alternate.id!));
      expect(result.current.pending).toBeNull();
      expect(result.current.canCall).toBe(true);
      expect(result.current.canText).toBe(sms_mode === "enforced");
    });

  it("keeps a manual first choice when only the provisional default changes", async () => {
    const { wrapper } = routed();
    const { result, rerender } = renderHook((value: Props) => useContactFromNumber(value), { wrapper, initialProps: props(unassigned) });
    await waitFor(() => expect(result.current.canCall).toBe(true));
    act(() => result.current.select(alternate.id!));
    const before = result.current.captureCallSelection();
    const suggested = { ...unassignedSender, id: "20000000-0000-4000-8000-000000000003", number: "+12135550103" };
    rerender(props({ ...unassigned, voice: suggested, sms: suggested }));
    expect(result.current.automatic).toBe(false);
    expect(result.current.sender?.id).toBe(alternate.id);
    expect(before && "isSelectionCurrent" in before && before.isSelectionCurrent?.()).toBe(true);
  });

  it("keeps the ordinary SMS sender ready when no automatic caller is available", async () => {
    const { wrapper } = routed({ resolveContactLocalCaller: async () => "" });
    const { result } = renderHook(() => useContactFromNumber(props(unassigned)), { wrapper });
    await waitFor(() => expect(result.current.canText).toBe(true));
    expect(result.current.captureCallSelection()).toBeNull();
  });

  it("allows calls when the automatic SMS sender is unavailable", async () => {
    const { wrapper } = routed();
    const noSms = { ...unassigned, sms: { ...unassignedSender, id: null, number: null, readiness: "unavailable" } };
    const { result } = renderHook(() => useContactFromNumber(props(noSms)), { wrapper });
    await waitFor(() => expect(result.current.canCall).toBe(true));
    expect(result.current.canText).toBe(false);
    expect(result.current.smsSelection.expectedSenderId).toBeNull();
  });

  it("uses an unassigned manual choice immediately and clears it on return to AI", async () => {
    const { wrapper } = routed();
    const { result } = renderHook(() => useContactFromNumber(props(unassigned)), { wrapper });
    await waitFor(() => expect(result.current.canCall).toBe(true));
    act(() => result.current.select(first.id!));
    expect(result.current.pending).toBeNull();
    expect(result.current.automatic).toBe(false);
    expect(result.current.captureCallSelection()).toMatchObject({ expectedCallerNumber: first.number });
    expect(result.current.captureCallSelection()).not.toHaveProperty("oneCallNumberId");
    expect(result.current.smsSelection.overrideSenderId).toBeNull();
    const original = result.current.captureCallSelection();
    await act(async () => result.current.select(LOCAL_PRESENCE_OPTION));
    expect(result.current.automatic).toBe(true);
    expect(original && "isSelectionCurrent" in original && original.isSelectionCurrent?.()).toBe(false);
    expect(result.current.pending).toBeNull();
    expect(api.change).not.toHaveBeenCalled();
  });

  it("retains explicit one-call and one-text intent for a manually selected personal number", async () => {
    const { wrapper } = routed({ getContactCallerRole: () => "personal" });
    const { result } = renderHook(() => useContactFromNumber(props(unassigned)), { wrapper });
    await waitFor(() => expect(result.current.canCall).toBe(true));
    act(() => result.current.select(alternate.id!));
    expect(result.current.pending).toBeNull();
    expect(result.current.captureCallSelection()).toMatchObject({ expectedCallerNumber: alternate.number, oneCallNumberId: alternate.id });
    expect(result.current.smsSelection.overrideSenderId).toBe(alternate.id);
    expect(api.change).not.toHaveBeenCalled();
  });

  it("drops a manual first choice when an assignment arrives at the same generation", async () => {
    const { wrapper } = routed();
    const { result, rerender } = renderHook((value: Props) => useContactFromNumber(value), { wrapper, initialProps: props(unassigned) });
    await waitFor(() => expect(result.current.canCall).toBe(true));
    act(() => result.current.select(alternate.id!));
    const original = result.current.captureCallSelection();
    rerender(props(preview));
    expect(result.current.temporary).toBe(false);
    expect(result.current.unassigned).toBe(false);
    expect(result.current.captureCallSelection()).toMatchObject({ expectedCallerNumber: first.number });
    expect(original && "isSelectionCurrent" in original && original.isSelectionCurrent?.()).toBe(false);
  });

  it("refuses a manual first choice whose agency or personal ownership cannot be verified", async () => {
    const { wrapper } = routed({ getContactCallerRole: () => null });
    const { result } = renderHook(() => useContactFromNumber(props(unassigned)), { wrapper });
    await waitFor(() => expect(result.current.canCall).toBe(true));
    act(() => result.current.select(alternate.id!));
    expect(result.current.canText).toBe(false);
    expect(result.current.captureCallSelection()).toBeNull();
  });

  it.each(["reserved", "needs_review", undefined])("does not bypass confirmation for an SMS state of %s", async state => {
    const { wrapper } = routed();
    const data = { ...unassigned, sms: { ...unassignedSender, state } };
    const { result } = renderHook(() => useContactFromNumber(props(data)), { wrapper });
    await waitFor(() => expect(result.current.disabled).toBe(false));
    expect(result.current.unassigned).toBe(false);
    act(() => result.current.select(alternate.id!));
    expect(result.current.pending?.sender.id).toEqual(alternate.id);
    expect(api.change).not.toHaveBeenCalled();
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
