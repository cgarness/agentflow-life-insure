import { Phone, PhoneOff, ArrowRight } from "lucide-react";
import ClaimRing from "./ClaimRing";

export interface DialerPrimaryActionsProps {
  voiceCallState: string; voiceCallDuration: number; claimRingActive: boolean; campaignType: string;
  fmtDuration: (seconds: number) => string; onHangUp: () => void; onCall: () => void; onSkip: () => void;
  callBlockedReason?: string | null; skipBlockedReason?: string | null; callPending?: boolean;
}
export function DialerPrimaryActions(props: DialerPrimaryActionsProps) {
  const active = ["active", "dialing", "incoming"].includes(props.voiceCallState);
  return <div className="mb-3 shrink-0">
    <div className="grid grid-cols-2 gap-2">
      {active ? <button onClick={props.onHangUp} className="bg-destructive text-destructive-foreground rounded-xl py-2 flex flex-col items-center justify-center gap-1 text-sm font-semibold transition-all hover:bg-destructive/90 shadow-lg shadow-destructive/20">
        <PhoneOff className="w-4 h-4" /><span className="leading-none">Hang Up</span>
        <span className="font-mono text-[9px] opacity-80">{props.fmtDuration(props.voiceCallDuration)}</span>
      </button> : <div className="relative">
        <ClaimRing active={props.claimRingActive} campaignType={props.campaignType} onClaim={() => {}} />
        <button onClick={props.onCall} disabled={!!props.callBlockedReason || props.callPending}
          aria-describedby={props.callBlockedReason ? "dialer-call-reason" : undefined}
          className="w-full bg-success text-success-foreground rounded-xl py-2 flex flex-col items-center justify-center gap-1 text-sm font-semibold transition-all hover:bg-success/90 shadow-lg shadow-success/20 disabled:opacity-40 disabled:cursor-not-allowed">
          <Phone className="w-4 h-4" /><span className="leading-none">{props.callPending ? "Starting…" : "Call"}</span>
        </button>
      </div>}
      <button onClick={props.onSkip} disabled={active || !!props.skipBlockedReason || props.callPending}
        title={props.skipBlockedReason ?? undefined}
        className="bg-accent text-accent-foreground border border-border rounded-xl py-2 flex flex-col items-center justify-center gap-1 text-sm font-semibold transition-all hover:bg-accent/80 disabled:opacity-40 disabled:cursor-not-allowed">
        <ArrowRight className="w-4 h-4" /><span className="leading-none">Skip</span>
      </button>
    </div>
    {!active && props.callBlockedReason && <p id="dialer-call-reason" role="status" className="mt-2 text-xs text-muted-foreground">{props.callBlockedReason}</p>}
  </div>;
}
