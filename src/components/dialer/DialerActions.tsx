import React from "react";
import { Phone, PhoneOff, ArrowRight, Check, X, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import ClaimRing from "./ClaimRing";
import LockTimerArc from "./LockTimerArc";
import QueuePanel from "./QueuePanel";

interface Disposition {
  id: string;
  name: string;
  color: string;
  requireNotes: boolean;
  minNoteChars: number;
  callbackScheduler: boolean;
  appointmentScheduler: boolean;
}

interface DialerActionsProps {
  telnyxCallState: string;
  telnyxCallDuration: number;
  amdEnabled: boolean;
  amdStatus: 'idle' | 'detecting' | 'human' | 'machine';
  claimRingActive: boolean;
  campaignType: string;
  lockMode: boolean;
  currentLead: any;
  leftTab: "dispositions" | "queue" | "scripts";
  dispositions: Disposition[];
  selectedDisp: Disposition | null;
  fmtDuration: (seconds: number) => string;
  onHangUp: () => void;
  onCall: () => void;
  onSkip: () => void;
  onSelectTab: (tab: "dispositions" | "queue" | "scripts") => void;
  onSelectDisposition: (disp: Disposition) => void;
  // Queue tab props
  queuePanelProps: React.ComponentProps<typeof QueuePanel>;
  // Scripts tab props
  availableScripts: { id: string; name: string; content: string }[];
  onOpenScript: (scriptId: string) => void;
}

export const DialerActions: React.FC<DialerActionsProps> = ({
  telnyxCallState,
  telnyxCallDuration,
  amdEnabled,
  amdStatus,
  claimRingActive,
  campaignType,
  lockMode,
  currentLead,
  leftTab,
  dispositions,
  selectedDisp,
  fmtDuration,
  onHangUp,
  onCall,
  onSkip,
  onSelectTab,
  onSelectDisposition,
  queuePanelProps,
  availableScripts,
  onOpenScript,
}) => {
  return (
    <div className="w-80 shrink-0 flex flex-col h-full overflow-hidden">
      {/* Top Actions: Hang Up / Skip / Call */}
      <div className="grid grid-cols-2 gap-2 mb-3 shrink-0">
        {telnyxCallState === "active" || telnyxCallState === "dialing" ? (
          <button
            onClick={onHangUp}
            className="bg-destructive text-destructive-foreground rounded-xl py-2 flex flex-col items-center justify-center gap-1 text-sm font-semibold transition-all hover:bg-destructive/90 shadow-lg shadow-destructive/20"
          >
            <PhoneOff className="w-4 h-4" />
            <span className="leading-none">Hang Up</span>
            <span className="font-mono text-[9px] opacity-80">{fmtDuration(telnyxCallDuration)}</span>
            {amdEnabled && amdStatus !== 'idle' && (
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                amdStatus === 'detecting' ? 'bg-yellow-500/20 text-yellow-400 animate-pulse' :
                amdStatus === 'human' ? 'bg-emerald-500/20 text-emerald-400' :
                amdStatus === 'machine' ? 'bg-red-500/20 text-red-400' : ''
              }`}>
                {amdStatus === 'detecting' ? '🔍 AMD' :
                 amdStatus === 'human' ? '👤 Human' :
                 amdStatus === 'machine' ? '🤖 Machine' : ''}
              </span>
            )}
          </button>
        ) : (
          <div className="relative">
            <ClaimRing
              active={claimRingActive}
              campaignType={campaignType}
              onClaim={() => {}}
            />
            <LockTimerArc
              active={lockMode && !!currentLead}
              campaignType={campaignType}
            />
            <button
              onClick={onCall}
              className="w-full bg-success text-success-foreground rounded-xl py-2 flex flex-col items-center justify-center gap-1 text-sm font-semibold transition-all hover:bg-success/90 shadow-lg shadow-success/20"
            >
              <Phone className="w-4 h-4" />
              <span className="leading-none">Call</span>
            </button>
          </div>
        )}
        <button
          onClick={onSkip}
          className="bg-accent text-accent-foreground border border-border rounded-xl py-2 flex flex-col items-center justify-center gap-1 text-sm font-semibold transition-all hover:bg-accent/80"
        >
          <ArrowRight className="w-4 h-4" />
          <span className="leading-none">Skip</span>
        </button>
      </div>

      {/* Main Controls Card */}
      <div className="bg-card border rounded-xl overflow-hidden flex flex-col flex-1 min-h-0 min-w-0">
        <div className="grid grid-cols-3 border-b shrink-0">
          {(["dispositions", "queue", "scripts"] as const).map((t) => (
            <button
              key={t}
              onClick={() => onSelectTab(t)}
              className={`py-2.5 text-[10px] uppercase tracking-widest font-bold transition-all ${
                leftTab === t
                  ? "bg-primary/10 text-primary border-b-2 border-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 min-h-0 bg-muted/5">
          {leftTab === "dispositions" && (
            <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-right-2 duration-300">
              <div>
                <label className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-2 block">
                  Select Outcome
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {dispositions.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => onSelectDisposition(d)}
                      className={cn(
                        "flex flex-col items-center justify-center p-2 rounded-lg border text-[10px] font-bold uppercase tracking-tight text-center transition-all h-16 group relative",
                        selectedDisp?.id === d.id
                          ? "ring-2 ring-primary border-primary bg-primary/10 text-primary"
                          : "border-border bg-card text-muted-foreground hover:bg-accent"
                      )}
                      style={selectedDisp?.id === d.id ? {} : {
                        backgroundColor: d.color ? `${d.color}15` : undefined,
                        borderColor: d.color ? `${d.color}30` : undefined,
                        color: d.color ?? undefined
                      }}
                    >
                      <span className="line-clamp-2">{d.name}</span>
                      <div className="absolute top-1 right-1 flex gap-0.5">
                        {d.requireNotes && <div className="w-1 h-1 rounded-full bg-current opacity-60" title="Notes Required" />}
                        {(d.appointmentScheduler || d.callbackScheduler) && <div className="w-1 h-1 rounded-full bg-current opacity-60" title="Scheduling Required" />}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {leftTab === "queue" && (
            <QueuePanel {...queuePanelProps} />
          )}

          {leftTab === "scripts" && (
            <div className="flex flex-col gap-2">
              {availableScripts.length === 0 ? (
                <div className="text-center py-8">
                  <FileText className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-20" />
                  <p className="text-sm text-muted-foreground">No scripts available</p>
                </div>
              ) : (
                availableScripts.map((script) => (
                  <button
                    key={script.id}
                    onClick={() => onOpenScript(script.id)}
                    className="w-full text-left p-3 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors flex items-center justify-between group"
                  >
                    <span className="text-xs font-bold text-foreground uppercase tracking-tight">
                      {script.name}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
