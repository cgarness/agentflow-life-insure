import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useTeamCampaignLeadVisibility } from "@/hooks/useTeamCampaignLeadVisibility";

afterEach(cleanup);

const row = { id: "queue-A", lead_id: "lead-A", campaign_id: "campaign-A", organization_id: "org-A" };
const base = {
  enabled: true, organizationId: "org-A", viewerId: "viewer-A", campaignId: "campaign-A",
  lead: row as Record<string, unknown> | null, confirmedLockLeadId: row.id as string | null,
  loading: false, advancing: false,
};
type Args = Parameters<typeof useTeamCampaignLeadVisibility>[0];

function confirmed() {
  const hook = renderHook((args: Args) => useTeamCampaignLeadVisibility(args), { initialProps: base });
  act(() => hook.result.current.beginLoad()(row));
  expect(hook.result.current.visible).toBe(true);
  return hook;
}

describe("Team display confirmation", () => {
  it("requires a successful queue load and the same confirmed lock without an outbound call", () => {
    const { result } = renderHook(() => useTeamCampaignLeadVisibility(base));
    expect(result.current.visible).toBe(false);
    act(() => result.current.beginLoad()(row));
    expect(result.current.visible).toBe(true);
  });

  it.each([
    { confirmedLockLeadId: null }, { confirmedLockLeadId: "queue-B" }, { lead: null },
    { loading: true }, { advancing: true }, { enabled: false }, { organizationId: null },
    { viewerId: null }, { campaignId: null }, { organizationId: "org-B" },
    { viewerId: "viewer-B" }, { campaignId: "campaign-B" },
    { lead: { ...row, id: "queue-B" } }, { lead: { ...row, lead_id: "lead-B" } },
    { lead: { ...row, campaign_id: "campaign-B" } }, { lead: { ...row, organization_id: "org-B" } },
  ])("masks immediately when the active context no longer matches: %j", (over) => {
    const { result, rerender } = confirmed();
    rerender({ ...base, ...over });
    expect(result.current.visible).toBe(false);
  });

  it.each([
    { organization_id: "org-B" }, { campaign_id: "campaign-B" }, { id: "" }, { id: null },
    { lead_id: "" }, { lead_id: null },
  ])("does not adopt invalid load confirmation: %j", (over) => {
    const { result } = renderHook(() => useTeamCampaignLeadVisibility(base));
    act(() => result.current.beginLoad()({ ...row, ...over }));
    expect(result.current.visible).toBe(false);
  });

  it("masks at load start and keeps the newest confirmation when an older load finishes", () => {
    const { result, rerender } = confirmed();
    let finishOld: ReturnType<typeof result.current.beginLoad>;
    let finishNew: ReturnType<typeof result.current.beginLoad>;
    act(() => { finishOld = result.current.beginLoad(); });
    expect(result.current.visible).toBe(false);
    act(() => { finishNew = result.current.beginLoad(); });
    const nextRow = { ...row, id: "queue-B", lead_id: "lead-B" };
    rerender({ ...base, lead: nextRow, confirmedLockLeadId: nextRow.id });
    act(() => finishNew(nextRow));
    expect(result.current.visible).toBe(true);
    act(() => finishOld(row));
    expect(result.current.visible).toBe(true);
  });

  it("rejects both stale starts and finishes after A → B → A without interrupting the current load", () => {
    const { result, rerender } = confirmed();
    const beginOld = result.current.beginLoad;
    let finishOld: ReturnType<typeof beginOld>;
    act(() => { finishOld = beginOld(); });
    rerender({ ...base, viewerId: "viewer-B" });
    rerender(base);
    expect(result.current.visible).toBe(false);
    act(() => result.current.beginLoad()(row));
    expect(result.current.visible).toBe(true);
    act(() => { beginOld()(row); finishOld(row); });
    expect(result.current.visible).toBe(true);
  });

  it("does not resurrect confirmation when Team display is disabled and re-enabled", () => {
    const { result, rerender } = confirmed();
    const oldBegin = result.current.beginLoad;
    rerender({ ...base, enabled: false });
    rerender(base);
    act(() => oldBegin()(row));
    expect(result.current.visible).toBe(false);
    act(() => result.current.beginLoad()(row));
    expect(result.current.visible).toBe(true);
  });

  it("consumes each successful confirmation once", () => {
    const { result, rerender } = renderHook((args: Args) => useTeamCampaignLeadVisibility(args), { initialProps: base });
    let finish: ReturnType<typeof result.current.beginLoad>;
    act(() => { finish = result.current.beginLoad(); finish(row); });
    const other = { ...row, id: "queue-B", lead_id: "lead-B" };
    rerender({ ...base, lead: other, confirmedLockLeadId: other.id });
    act(() => finish(other));
    expect(result.current.visible).toBe(false);
  });

  it("rejects starts and finishes after unmount", () => {
    const { result, unmount } = renderHook(() => useTeamCampaignLeadVisibility(base));
    const begin = result.current.beginLoad;
    let finish: ReturnType<typeof begin>;
    act(() => { finish = begin(); });
    unmount();
    expect(() => { begin()(row); finish(row); }).not.toThrow();
  });
});
