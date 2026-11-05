import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useDialerContactUrl, useDialerNavigation } from "@/hooks/useDialerNavigation";
import { applyDispositionToQueue, type CampaignLead } from "@/lib/queue-manager";
import { navigationBlockReason } from "@/lib/dialer-navigation";
const leads = ["a", "b", "c"].map(id => ({ id, lead_id: `contact-${id}`, status: "Queued", call_attempts: 0 }));
afterEach(cleanup);
describe("dialer membership and action ownership", () => {
  it("keeps the same membership through a queue resort, and commits exactly one next identity", () => {
    const { result } = renderHook(() => useDialerNavigation<CampaignLead>("org:user:campaign"));
    act(() => result.current.commitQueue(leads, "b"));
    act(() => result.current.setLeadQueue([leads[2],leads[0],leads[1]]));
    expect(result.current.currentLead?.id).toBe("b");
    let action!: NonNullable<ReturnType<typeof result.current.begin>>;
    act(() => { action = result.current.begin()!; });
    expect(result.current.begin()).toBeNull();
    act(() => {
      const row = { ...leads[1], status: "Skipped", retry_eligible_at: "2099-01-01T00:00:00Z" };
      const queue = applyDispositionToQueue(leads, row, "", 60, null, new Date());
      result.current.commitQueue(queue, "a"); action.finish();
    });
    expect(result.current.currentLead?.id).toBe("a");
    expect(action.isCurrent()).toBe(false);
    expect(result.current.isBusy()).toBe(false);
  });
  it("an old completion cannot release a newer action or adopt a stale campaign", () => {
    const { result, rerender } = renderHook(({ scope }) => useDialerNavigation<CampaignLead>(scope), {initialProps:{scope:"one"}});
    let old!: NonNullable<ReturnType<typeof result.current.begin>>;
    act(() => { result.current.commitQueue(leads,"b"); old = result.current.begin()!; });
    rerender({scope:"two"});
    expect(result.current.currentLead).toBeNull();
    rerender({scope:"one"}); // Returning to the same ID is a NEW visit, not the old owner.
    expect(old.isScopeCurrent()).toBe(false);
    let next!: typeof old;
    act(() => { next=result.current.begin()!; old.finish(); });
    expect(old.isScopeCurrent()).toBe(false);
    expect(result.current.isBusy()).toBe(true);
    act(() => next.finish());
    expect(result.current.isBusy()).toBe(false);
  });
  it("exhaustion stays empty instead of selecting an ineligible index zero", () => {
    const { result } = renderHook(() => useDialerNavigation<CampaignLead>("one"));
    act(() => result.current.commitQueue(leads, null));
    expect(result.current.currentLead).toBeNull();
    expect(result.current.currentLeadIndex).toBe(-1);
  });
  it.each(["active","dialing","incoming"])("blocks navigation during %s", callState => {
    expect(navigationBlockReason({busy:false,callState,saving:false,draft:false})).toBeTruthy();
  });
  it("blocks drafts and failed saves, but permits a saved outcome", () => {
    expect(navigationBlockReason({busy:false,callState:"ended",saving:false,draft:true})).toMatch(/Save/);
    expect(navigationBlockReason({busy:false,callState:"ended",saving:true,draft:true})).toMatch(/wait/);
    expect(navigationBlockReason({busy:false,callState:"ended",saving:false,draft:false})).toBeNull();
  });
  it("URL echoes cannot rewind a committed Skip; Back is guarded while dirty", () => {
    const writes:string[]=[];
    let contact:string|null="contact-b", blocked=false;
    const { result, rerender } = renderHook(() => {
      const n=useDialerNavigation<CampaignLead>("one");
      useDialerContactUrl({scope:"one",contact,lead:n.currentLead,queue:n.leadQueue,loading:false,
        blocked:()=>blocked,select:n.setCurrentLeadIndex,write:id=>writes.push(id)});
      return n;
    });
    act(()=>result.current.commitQueue(leads,"b"));
    act(()=>result.current.commitQueue([leads[0],leads[2],leads[1]],"a"));
    expect(result.current.currentLead?.id).toBe("a"); expect(writes.at(-1)).toBe("contact-a");
    contact="contact-a"; rerender(); // router acknowledges own replace
    blocked=true; contact="contact-b"; rerender();
    expect(result.current.currentLead?.id).toBe("a"); expect(writes.at(-1)).toBe("contact-a");
    contact="contact-a"; rerender(); blocked=false; contact="contact-c"; rerender();
    expect(result.current.currentLead?.id).toBe("c");
  });
});
