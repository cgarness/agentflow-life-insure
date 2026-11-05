import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DialerPrimaryActions } from "@/components/dialer/DialerPrimaryActions";
afterEach(cleanup);
const base=()=>({voiceCallState:"idle",voiceCallDuration:0,claimRingActive:false,campaignType:"Personal",fmtDuration:()=>"0:00",onHangUp:vi.fn(),onCall:vi.fn(),onSkip:vi.fn()});
it("disabled Call explains readiness, disabled Skip keeps the draft",()=>{
 const p=base();render(<DialerPrimaryActions {...p} callBlockedReason="Phone is connecting." skipBlockedReason="Save the outcome first." />);
 fireEvent.click(screen.getByRole("button",{name:"Call"}));fireEvent.click(screen.getByRole("button",{name:"Skip"}));
 expect(p.onCall).not.toHaveBeenCalled();expect(p.onSkip).not.toHaveBeenCalled();expect(screen.getByRole("status")).toHaveTextContent("Phone is connecting.");
});
it("in-flight preflight disables both actions but a live call keeps Hang Up available",()=>{
 const p=base();const {rerender}=render(<DialerPrimaryActions {...p} callPending />);
 expect(screen.getByRole("button",{name:"Starting…"})).toBeDisabled();expect(screen.getByRole("button",{name:"Skip"})).toBeDisabled();
 rerender(<DialerPrimaryActions {...p} voiceCallState="active" callPending />);fireEvent.click(screen.getByRole("button",{name:/Hang Up/}));expect(p.onHangUp).toHaveBeenCalledOnce();
});
