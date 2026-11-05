import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDialerStateMachine, type UseDialerStateMachineProps } from "@/hooks/useDialerStateMachine";
const props=():UseDialerStateMachineProps=>({isAutoDialEnabled:true,twilioCallState:"idle",twilioStatus:"ready",currentLead:{id:"a",state:"TX"},hasDialedOnce:{current:true},showWrapUp:false,onCall:vi.fn(),onSkip:vi.fn(),onBlocked:vi.fn(),checkCallingHours:()=>true,dialDelayMs:500});
beforeEach(()=>vi.useFakeTimers()); afterEach(()=>{cleanup();vi.useRealTimers();});
describe("automatic dial scheduling",()=>{
  it("pauses once outside hours and never persists Skip even after guard churn",()=>{
    const p=props(); p.checkCallingHours=()=>false;
    const {rerender}=renderHook(v=>useDialerStateMachine(v),{initialProps:p});
    for(let i=0;i<10;i++){rerender({...p,isAdvancing:true});rerender({...p,isAdvancing:false});}
    act(()=>vi.advanceTimersByTime(20000));
    expect(p.onBlocked).toHaveBeenCalledTimes(1);expect(p.onSkip).not.toHaveBeenCalled();expect(p.onCall).not.toHaveBeenCalled();
  });
  it.each(["manual","draft","not-ready","transition","first-call"])("cancels a pending auto dial for %s",mode=>{
    const p=props();const {rerender}=renderHook(v=>useDialerStateMachine(v),{initialProps:p});
    if(mode==="manual")p.isAutoDialEnabled=false;if(mode==="draft")p.showWrapUp=true;if(mode==="not-ready")p.twilioStatus="connecting";if(mode==="transition")p.isAdvancing=true;if(mode==="first-call")p.hasDialedOnce.current=false;
    rerender({...p});act(()=>vi.advanceTimersByTime(3000));expect(p.onCall).not.toHaveBeenCalled();
  });
  it("only the latest lead is called once and rechecks hours at fire time",()=>{
    const p=props();let hours=true;p.checkCallingHours=()=>hours;
    const {rerender}=renderHook(v=>useDialerStateMachine(v),{initialProps:p});
    act(()=>vi.advanceTimersByTime(250));rerender({...p,currentLead:{id:"b"}});hours=false;
    act(()=>vi.advanceTimersByTime(500));expect(p.onCall).not.toHaveBeenCalled();expect(p.onBlocked).toHaveBeenCalledOnce();
  });
  it("defers a future callback and dispatches a ready lead only once",()=>{
    const p=props();p.shouldDeferAutoDial=()=>true;
    const {rerender}=renderHook(v=>useDialerStateMachine(v),{initialProps:p});
    act(()=>vi.advanceTimersByTime(5000));expect(p.onCall).not.toHaveBeenCalled();
    rerender({...p,currentLead:{id:"b"},shouldDeferAutoDial:()=>false});act(()=>vi.advanceTimersByTime(5000));
    expect(p.onCall).toHaveBeenCalledOnce();
  });
});
