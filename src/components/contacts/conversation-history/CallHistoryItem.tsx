import React, { useId, useState } from "react";
import { Mic, PhoneIncoming, PhoneOutgoing, Play } from "lucide-react";
import { cn, getStatusColorStyle } from "@/lib/utils";
import { useBranding } from "@/contexts/BrandingContext";
import { formatPhoneNumber } from "@/utils/phoneUtils";
import { normalizeDispositionValue } from "@/lib/supabase-contacts";
import { RecordingPlayer } from "@/components/ui/RecordingPlayer";
import { VoicemailPlayer } from "@/components/voicemail/VoicemailPlayer";
import { DetailsPanel, DetailsToggleButton, type DetailRow } from "./CommunicationDetails";
import { formatCallDuration, type CallConversationItem } from "./conversationTypes";

/**
 * Neutral full-width call event card — deliberately NOT a chat bubble and never
 * iMessage blue. Recording playback keeps the existing RecordingPlayer contract
 * (`callId` + `compact`); URLs/storage/authorization are untouched.
 */
export const CallHistoryItem: React.FC<{
  item: CallConversationItem;
  /** Agency disposition colors keyed by normalizeDispositionValue(name); absent/unmatched → neutral badge. */
  dispositionColors?: Record<string, string>;
}> = ({ item, dispositionColors }) => {
  const { formatDateTime } = useBranding();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [recordingOpen, setRecordingOpen] = useState(false);
  const panelId = useId();
  const DirectionIcon = item.outbound ? PhoneOutgoing : PhoneIncoming;
  const dispositionColor = item.dispositionName
    ? dispositionColors?.[normalizeDispositionValue(item.dispositionName)]
    : undefined;

  const rows: DetailRow[] = [
    { label: "Contact number", value: item.contactPhone ? formatPhoneNumber(item.contactPhone) : null },
    { label: "AgentFlow number", value: item.agentflowNumber ? formatPhoneNumber(item.agentflowNumber) : null },
    { label: "Direction", value: item.directionLabel || "Not recorded" },
    { label: item.startedAt ? "Started" : "Recorded", value: item.startedAt && Number.isFinite(Date.parse(item.startedAt)) ? formatDateTime(new Date(item.startedAt)) : item.timestampKnown ? formatDateTime(new Date(item.timestampMs)) : null },
    { label: "Ended", value: item.endedAt && Number.isFinite(Date.parse(item.endedAt)) ? formatDateTime(new Date(item.endedAt)) : null },
    { label: ["queued", "initiated", "ringing", "in-progress"].includes(item.status || "") ? "Duration (in progress)" : "Duration", value: formatCallDuration(item.durationSeconds) },
    { label: "Agent", value: item.agentLabel === "Routed to" ? "Agent unavailable" : item.agentName },
    ...(item.routedAgents?.length ? [{ label: "Routed to", value: item.routedAgents.join(", ") }] : []),
    ...(item.answeredAgent ? [{ label: "Answered by", value: item.answeredAgent }] : []),
    ...(item.missedForAgent ? [{ label: "Missed for", value: item.missedForAgent }] : []),
    { label: "Status", value: item.status },
    { label: "Outcome", value: item.inboundOutcomeLabel || item.outcome },
    { label: "Disposition", value: item.dispositionName },
    { label: "Campaign", value: item.campaignName },
    { label: "Call notes", value: item.notes },
  ];

  return (
    <div className="w-full min-w-0 rounded-lg border border-border bg-card shadow-sm px-3.5 py-2.5">
      <div className="flex items-center gap-2.5 flex-wrap min-w-0">
        <span className="w-7 h-7 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0">
          <DirectionIcon className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
        </span>
        <span className="text-sm font-semibold text-foreground shrink-0">
          {item.directionLabel ? `${item.directionLabel} Call` : "Call"}
        </span>
        {item.inboundMissed && item.inboundOutcomeLabel ? (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-red-500/10 text-red-600 dark:text-red-400 break-words" data-testid="inbound-outcome-label">
            {item.inboundOutcomeLabel}
          </span>
        ) : null}
        {item.dispositionName ? (
          <span
            className={cn(
              "text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider break-words",
              dispositionColor ? "border" : "bg-muted text-foreground/70",
            )}
            style={dispositionColor ? getStatusColorStyle(dispositionColor) : undefined}
          >
            {item.dispositionName}
          </span>
        ) : item.outcome || item.status ? (
          <span className="text-[11px] text-muted-foreground capitalize">{item.outcome || item.status}</span>
        ) : null}
        <span className="text-[11px] font-medium text-muted-foreground ml-auto shrink-0">
          {formatCallDuration(item.durationSeconds)}
        </span>
      </div>

      <div className="mt-1.5 flex items-center gap-3 flex-wrap min-w-0">
        <span className="text-[11px] text-muted-foreground">{item.agentLabel || "Agent"}: {item.agentName || "Agent unavailable"}</span>
        <span className="text-[10px] text-muted-foreground">{item.timestampKnown === false ? "Date not recorded" : formatDateTime(new Date(item.timestampMs))}</span>
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

      {item.voicemailId ? (
        <div className="mt-2">
          <VoicemailPlayer voicemailId={item.voicemailId} compact />
        </div>
      ) : null}

      {detailsOpen ? <DetailsPanel id={panelId} rows={rows} className="mt-2" missingLabel="Not recorded" /> : null}
    </div>
  );
};
