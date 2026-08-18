import React, { useId, useState } from "react";
import { Mic, PhoneIncoming, PhoneOutgoing, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBranding } from "@/contexts/BrandingContext";
import { formatPhoneNumber } from "@/utils/phoneUtils";
import { RecordingPlayer } from "@/components/ui/RecordingPlayer";
import { DetailsPanel, DetailsToggleButton, type DetailRow } from "./CommunicationDetails";
import { formatCallDuration, type CallConversationItem } from "./conversationTypes";

/**
 * Neutral full-width call event card — deliberately NOT a chat bubble and never
 * iMessage blue. Recording playback keeps the existing RecordingPlayer contract
 * (`callId` + `compact`); URLs/storage/authorization are untouched.
 */
export const CallHistoryItem: React.FC<{ item: CallConversationItem }> = ({ item }) => {
  const { formatDateTime } = useBranding();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [recordingOpen, setRecordingOpen] = useState(false);
  const panelId = useId();
  const DirectionIcon = item.outbound ? PhoneOutgoing : PhoneIncoming;

  const rows: DetailRow[] = [
    { label: "Contact number", value: item.contactPhone ? formatPhoneNumber(item.contactPhone) : null },
    { label: "AgentFlow number", value: item.agentflowNumber ? formatPhoneNumber(item.agentflowNumber) : null },
    { label: "Direction", value: item.outbound ? "Outbound" : "Inbound" },
    { label: "Started", value: item.startedAt ? formatDateTime(new Date(item.startedAt)) : null },
    ...(item.endedAt ? [{ label: "Ended", value: formatDateTime(new Date(item.endedAt)) }] : []),
    { label: "Duration", value: formatCallDuration(item.durationSeconds) },
    { label: "Status", value: item.status },
    ...(item.dispositionName ? [{ label: "Disposition", value: item.dispositionName }] : []),
  ];

  return (
    <div className="w-full min-w-0 rounded-lg border border-border bg-card shadow-sm px-3.5 py-2.5">
      <div className="flex items-center gap-2.5 flex-wrap min-w-0">
        <span className="w-7 h-7 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0">
          <DirectionIcon className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
        </span>
        <span className="text-sm font-semibold text-foreground shrink-0">
          {item.outbound ? "Outbound Call" : "Inbound Call"}
        </span>
        {item.dispositionName ? (
          <span className="text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider bg-muted text-foreground/70 break-words">
            {item.dispositionName}
          </span>
        ) : item.status ? (
          <span className="text-[11px] text-muted-foreground capitalize">{item.status}</span>
        ) : null}
        <span className="text-[11px] font-medium text-muted-foreground ml-auto shrink-0">
          {formatCallDuration(item.durationSeconds)}
        </span>
      </div>

      <div className="mt-1.5 flex items-center gap-3 flex-wrap min-w-0">
        <span className="text-[10px] text-muted-foreground">{formatDateTime(new Date(item.timestampMs))}</span>
        {item.recordingAvailable ? (
          <button
            type="button"
            onClick={() => setRecordingOpen((o) => !o)}
            className="inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:text-primary/80 transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={recordingOpen ? "Hide Recording" : "Play Recording"}
          >
            <Play className={cn("w-3 h-3", recordingOpen && "fill-current")} aria-hidden />
            Recording
          </button>
        ) : null}
        <DetailsToggleButton
          open={detailsOpen}
          onClick={() => setDetailsOpen((o) => !o)}
          panelId={panelId}
          label="Call details"
        />
      </div>

      {item.recordingAvailable && recordingOpen ? (
        <div className="mt-3 pt-3 border-t border-border/50 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest mb-3 text-foreground">
            <div className="w-6 h-6 rounded-full flex items-center justify-center bg-primary/10">
              <Mic className="w-3 h-3 text-current" aria-hidden />
            </div>
            <span>Call Recording</span>
          </div>
          <div className="rounded-xl p-3 bg-accent/50 border border-border/50">
            <RecordingPlayer callId={item.id} compact />
          </div>
        </div>
      ) : null}

      {detailsOpen ? <DetailsPanel id={panelId} rows={rows} className="mt-2" /> : null}
    </div>
  );
};
