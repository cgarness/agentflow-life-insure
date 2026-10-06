import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeReportLayout, type ReportLayoutConfig } from "@/lib/report-layout-constants";

type Pending = { action: string; resolve: (layout: ReportLayoutConfig) => void; reject: (error: Error) => void };
const h = vi.hoisted(() => ({ fetch: vi.fn(), save: vi.fn(), reset: vi.fn(), pending: [] as Pending[] }));
vi.mock("@/lib/report-layout", async () => {
  const { normalizeReportLayout } = await import("@/lib/report-layout-constants");
  return { getDefaultLayout: () => normalizeReportLayout(null), fetchUserLayout: h.fetch, saveUserLayout: h.save, resetUserLayout: h.reset };
});
import { useReportLayout } from "@/hooks/useReportLayout";

function pending(action: string) {
  return new Promise<ReportLayoutConfig>((resolve, reject) => h.pending.push({ action, resolve, reject }));
}
const saved = (id = "stat_inbound") => normalizeReportLayout({ version: 4, sections: [{ id, visible: true }] });
function settle(action: string, layout = saved(), index = 0) {
  const p = h.pending.filter((p) => p.action === action)[index];
  if (!p) throw new Error(`No pending ${action}`);
  h.pending.splice(h.pending.indexOf(p), 1); p.resolve(layout);
}
function reject(action: string, text: string) {
  const p = h.pending.find((p) => p.action === action);
  if (!p) throw new Error(`No pending ${action}`);
  h.pending.splice(h.pending.indexOf(p), 1); p.reject(new Error(text));
}
const props = { viewer: "user-1" as string | null, org: "org-1", enabled: true };
function setup(initial = props) {
  return renderHook(({ viewer, org, enabled }) => useReportLayout(viewer, org, enabled), { initialProps: initial });
}
beforeEach(() => {
  h.pending = [];
  h.fetch.mockReset().mockImplementation(() => pending("fetch"));
  h.save.mockReset().mockImplementation(() => pending("save"));
  h.reset.mockReset().mockImplementation(() => pending("reset"));
});

describe("owner-bound Reports layout", () => {
  it("blocks reads and writes for View As/unready Reports and loading preferences", async () => {
    const { result, rerender } = setup({ ...props, enabled: false });
    expect(h.fetch).not.toHaveBeenCalled(); expect(result.current.canEdit).toBe(false);
    act(() => result.current.beginEdit());
    expect(await result.current.save()).toBe(false); expect(result.current.editMode).toBe(false);
    rerender(props);
    expect(result.current.status).toBe("loading");
    act(() => result.current.beginEdit());
    expect(await result.current.reset()).toBe(false);
    await act(async () => settle("fetch"));
    expect(result.current.canEdit).toBe(true);
    rerender({ ...props, viewer: null });
    expect(result.current.editMode).toBe(false); expect(result.current.canEdit).toBe(false);
    expect(await result.current.save()).toBe(false);
    expect(h.fetch).toHaveBeenCalledTimes(1); expect(h.save).not.toHaveBeenCalled();
  });

  it("uses a separate draft and cancels without persisting", async () => {
    const { result } = setup(); await act(async () => settle("fetch"));
    act(() => result.current.beginEdit());
    act(() => result.current.setSections([{ id: "stat_total_dials", visible: true }]));
    expect(result.current.layout.sections[0].id).toBe("stat_inbound");
    expect(result.current.draft.sections[0].id).toBe("stat_total_dials");
    act(() => result.current.cancel());
    expect(result.current.editMode).toBe(false); expect(result.current.draft).toEqual(result.current.layout);
    expect(h.save).not.toHaveBeenCalled();
  });

  it("keeps an unsaved draft/error after failure, then commits only acknowledged success", async () => {
    const { result } = setup(); await act(async () => settle("fetch"));
    act(() => result.current.beginEdit());
    act(() => result.current.setSections([{ id: "stat_total_dials", visible: true }]));
    const draft = result.current.draft;
    let completion!: Promise<boolean>;
    act(() => { completion = result.current.save(); });
    expect(result.current.busy).toBe(true);
    await act(async () => reject("save", "Save unavailable"));
    expect(await completion).toBe(false);
    expect(result.current.editMode).toBe(true); expect(result.current.draft).toEqual(draft);
    expect(result.current.error).toBe("Save unavailable"); expect(result.current.layout.sections[0].id).toBe("stat_inbound");
    act(() => { completion = result.current.save(); });
    await act(async () => settle("save", draft));
    expect(await completion).toBe(true); expect(result.current.layout).toEqual(draft);
    expect(result.current.editMode).toBe(false); expect(result.current.error).toBeNull();
    expect(h.save).toHaveBeenLastCalledWith({ userId: "user-1", orgId: "org-1" }, draft);
  });

  it("serializes same-tick Save/Reset and blocks draft/cancel/reload while writing", async () => {
    const { result } = setup(); await act(async () => settle("fetch"));
    act(() => result.current.beginEdit());
    const draft = result.current.draft;
    let first!: Promise<boolean>, second!: Promise<boolean>, reset!: Promise<boolean>;
    act(() => { first = result.current.save(); second = result.current.save(); reset = result.current.reset(); });
    act(() => { result.current.cancel(); result.current.setSections([]); result.current.reload(); });
    expect(await second).toBe(false); expect(await reset).toBe(false);
    expect(h.save).toHaveBeenCalledTimes(1); expect(h.reset).not.toHaveBeenCalled();
    expect(result.current.draft).toEqual(draft); expect(result.current.editMode).toBe(true);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    await act(async () => settle("save", draft)); expect(await first).toBe(true);
  });

  it("preserves same-owner preferences and draft through temporary Reports unavailability without refetch", async () => {
    const { result, rerender } = setup(); await act(async () => settle("fetch"));
    act(() => result.current.beginEdit()); act(() => result.current.setSections([]));
    const draft = result.current.draft;
    rerender({ ...props, enabled: false });
    expect(result.current.draft).toEqual(draft); expect(result.current.canEdit).toBe(false);
    expect(await result.current.save()).toBe(false);
    rerender(props);
    expect(result.current.draft).toEqual(draft); expect(result.current.editMode).toBe(true);
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  it("masks old identity immediately, rejects stale callbacks, and ignores an old save completion", async () => {
    const { result, rerender } = setup(); await act(async () => settle("fetch"));
    act(() => result.current.beginEdit());
    const staleSave = result.current.save;
    let oldCompletion!: Promise<boolean>;
    act(() => { oldCompletion = result.current.save(); });
    rerender({ ...props, viewer: "user-2" });
    expect(result.current.status).toBe("loading"); expect(result.current.editMode).toBe(false);
    expect(result.current.layout.sections[0].id).not.toBe("stat_inbound");
    expect(await staleSave()).toBe(false);
    await act(async () => settle("fetch", saved("stat_dnc_count")));
    await act(async () => settle("save", saved("stat_inbound")));
    expect(await oldCompletion).toBe(false);
    expect(result.current.layout.sections[0].id).toBe("stat_dnc_count");
    expect(result.current.busy).toBe(false); expect(h.save).toHaveBeenCalledTimes(1);
  });

  it("rejects a stale A response even after switching A to B to A", async () => {
    const { result, rerender } = setup();
    rerender({ ...props, viewer: "user-2" }); rerender(props);
    expect(h.fetch).toHaveBeenCalledTimes(3);
    await act(async () => settle("fetch", saved("stat_dnc_count"), 2));
    await act(async () => settle("fetch", saved("stat_inbound"), 0));
    expect(result.current.layout.sections[0].id).toBe("stat_dnc_count");
    await act(async () => settle("fetch", saved("stat_total_dials"), 0));
    expect(result.current.layout.sections[0].id).toBe("stat_dnc_count");
  });

  it("keeps reset failure editable and uses the acknowledged inherited default on retry", async () => {
    const { result } = setup(); await act(async () => settle("fetch"));
    act(() => result.current.beginEdit());
    let completion!: Promise<boolean>;
    act(() => { completion = result.current.reset(); });
    await act(async () => reject("reset", "Reset failed"));
    expect(await completion).toBe(false); expect(result.current.editMode).toBe(true);
    expect(result.current.error).toBe("Reset failed");
    act(() => { completion = result.current.reset(); });
    await act(async () => settle("reset", saved("stat_dnc_count")));
    expect(await completion).toBe(true); expect(result.current.editMode).toBe(false);
    expect(result.current.layout.sections[0].id).toBe("stat_dnc_count");
  });

  it("requires a successful explicit retry after load failure", async () => {
    const { result } = setup(); await act(async () => reject("fetch", "Preferences unavailable"));
    expect(result.current.status).toBe("error"); expect(result.current.canEdit).toBe(false);
    act(() => result.current.beginEdit()); expect(result.current.editMode).toBe(false);
    act(() => result.current.reload());
    await act(async () => settle("fetch"));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.error).toBeNull();
  });
});
