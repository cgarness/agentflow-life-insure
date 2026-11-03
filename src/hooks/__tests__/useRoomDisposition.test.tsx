import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ persist: vi.fn() }));
vi.mock("@/lib/dialer-disposition", () => ({
  persistDisposition: mock.persist,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/supabase-clients", () => ({ clientsSupabaseApi: {} }));
vi.mock("@/lib/supabase-contacts", () => ({ rowToLead: vi.fn() }));
import { useRoomDisposition } from "@/hooks/useRoomDisposition";
const call = {
  id: "a5000000-0000-0000-0000-000000000001",
  contact_id: null,
  contact_type: null,
  contact_name: null,
  contact_phone: "+12025550123",
  ended_at: "2026-11-03T10:00:00Z",
  status: "completed",
  duration: 30,
  voicemail_id: null,
  created_at: "2026-11-03T09:59:00Z",
};
const config = {
  scopeKey: "test",
  version: {scopeKey:"test",attempt:0},
  status: "ready" as const,
  isCurrent: () => true,
  retry: vi.fn(),
  pipelineStages: [],
  dispositions: [
    {
      id: "a3000000-0000-0000-0000-000000000001",
      name: "Configured outcome",
      color: "blue",
      require_notes: true,
      min_note_chars: 5,
      callback_scheduler: false,
      automation_trigger: false,
      automation_id: null,
      pipeline_stage_id: null,
    },
  ],
};
beforeEach(() => mock.persist.mockReset());
it("never releases wrap-up on missing required notes or a failed save", async () => {
  const saved = vi.fn(async () => {}),
    h = renderHook(() => useRoomDisposition(call, "org", config, saved));
  act(() => h.result.current.setSelected(config.dispositions[0].id));
  await act(() => h.result.current.save());
  expect(mock.persist).not.toHaveBeenCalled();
  act(() => h.result.current.setNotes("Caller requested follow-up"));
  mock.persist.mockRejectedValueOnce(Error("offline"));
  await act(() => h.result.current.save());
  expect(saved).not.toHaveBeenCalled();
  expect(h.result.current.error).toBe("offline");
});
it("uses the canonical idempotent call save and confirms the matching call before release", async () => {
  const saved = vi.fn(async () => {}),
    h = renderHook(() => useRoomDisposition(call, "org", config, saved));
  act(() => {
    h.result.current.setSelected(config.dispositions[0].id);
    h.result.current.setNotes("Valid call notes");
  });
  mock.persist.mockResolvedValue({ call_id: call.id });
  await act(() => h.result.current.save());
  expect(mock.persist).toHaveBeenCalledWith(
    expect.objectContaining({
      callId: call.id,
      operationId: call.id,
      dispositionId: config.dispositions[0].id,
      releaseLock: false,
    }),
  );
  expect(saved).toHaveBeenCalledOnce();
});
it("refuses disposition while the authoritative call is still active", async () => {
  const saved = vi.fn(async () => {}),
    h = renderHook(() =>
      useRoomDisposition({ ...call, ended_at: null }, "org", config, saved),
    );
  act(() => {
    h.result.current.setSelected(config.dispositions[0].id);
    h.result.current.setNotes("Valid call notes");
  });
  await act(() => h.result.current.save());
  expect(mock.persist).not.toHaveBeenCalled();
  expect(saved).not.toHaveBeenCalled();
});
