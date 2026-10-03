import React, { useId, useState } from "react";
import { PhoneIncoming, PhoneOutgoing } from "lucide-react";
import { cn, getStatusColorStyle } from "@/lib/utils";
import { useBranding } from "@/contexts/BrandingContext";
import { formatPhoneNumber } from "@/utils/phoneUtils";
import { normalizeDispositionValue } from "@/lib/supabase-contacts";
import { RecordingPlayer } from "@/components/ui/RecordingPlayer";
import { VoicemailPlayer } from "@/components/voicemail/VoicemailPlayer";
import { DetailsPanel, DetailsToggleButton, type DetailRow } from "./CommunicationDetails";
import { formatCallDuration, type CallConversationItem } from "./conversationTypes";

/**
 * Compact neutral call card. Direction determines the icon side; one disclosure
 * reveals all recorded details and media using the existing playback contracts.
 */
export const CallHistoryItem: React.FC<{
  item: CallConversationItem;
  /** Agency disposition colors keyed by normalizeDispositionValue(name); absent/unmatched → neutral badge. */
  dispositionColors?: Record<string, string>;
}> = ({ item, dispositionColors }) => {
  const { formatDateTime } = useBranding();
  const [detailsOpen, setDetailsOpen] = useState(false);
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

  const summary = item.inboundMissed && item.inboundOutcomeLabel
    ? item.inboundOutcomeLabel
    : item.dispositionName || item.outcome || item.status || "Not recorded";
  const agent = `${item.agentLabel || "Agent"}: ${item.agentName || "Agent unavailable"}`;

  return (
    <div className="w-full min-w-0 rounded-lg border border-border bg-card px-3 py-2">
      <div className={cn("flex items-start gap-2 min-w-0", item.outbound && "flex-row-reverse")}>
        <span className="mt-0.5 w-6 h-6 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0">
          <DirectionIcon className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-semibold text-foreground shrink-0">
              {item.directionLabel ? `${item.directionLabel} Call` : "Call"}
            </span>
            <span
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded font-medium truncate min-w-0",
                item.inboundMissed ? "bg-red-500/10 text-red-600 dark:text-red-400"
                  : item.dispositionName && dispositionColor ? "border" : "bg-muted text-foreground/70",
              )}
              style={!item.inboundMissed && dispositionColor ? getStatusColorStyle(dispositionColor) : undefined}
              title={summary}
            >
              {summary}
            </span>
            <span className="ml-auto text-[10px] text-muted-foreground tabular-nums shrink-0">
              {formatCallDuration(item.durationSeconds)}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0 text-[10px] text-muted-foreground">
            <span className="flex-1 min-w-[8rem] truncate" title={agent}>{agent}</span>
            <div className="ml-auto flex items-center gap-2">
              <span className="shrink-0">
                {item.timestampKnown === false ? "Date not recorded" : formatDateTime(new Date(item.timestampMs))}
              </span>
              <DetailsToggleButton open={detailsOpen} onClick={() => setDetailsOpen((open) => !open)} panelId={panelId} label="Call details" />
            </div>
          </div>
        </div>
      </div>
      {detailsOpen ? (
        <div id={panelId} className="mt-2 space-y-2">
          <DetailsPanel id={`${panelId}-metadata`} rows={rows} missingLabel="Not recorded" />
          {item.recordingAvailable ? (
            <section aria-label="Call recording" className="rounded-lg border border-border bg-muted/40 p-2">
              <p className="text-[10px] font-medium text-muted-foreground mb-1">Recording</p>
              <RecordingPlayer callId={item.id} compact />
            </section>
          ) : null}
          {item.voicemailId ? (
            <section aria-label="Call voicemail" className="rounded-lg border border-border bg-muted/40 p-2">
              <p className="text-[10px] font-medium text-muted-foreground mb-1">Voicemail</p>
              <VoicemailPlayer voicemailId={item.voicemailId} compact />
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
