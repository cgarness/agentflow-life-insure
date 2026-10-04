import React, { useId } from "react";
import { PhoneIncoming, PhoneOutgoing } from "lucide-react";
import { cn, getStatusColorStyle } from "@/lib/utils";
import { useBranding } from "@/contexts/BrandingContext";
import { formatPhoneNumber } from "@/utils/phoneUtils";
import { normalizeDispositionValue } from "@/lib/supabase-contacts";
import { RecordingPlayer } from "@/components/ui/RecordingPlayer";
import { VoicemailPlayer } from "@/components/voicemail/VoicemailPlayer";
import { DetailsPanel, type DetailRow } from "./CommunicationDetails";
import { CommunicationHistoryPill } from "./CommunicationHistoryPill";
import { formatCallDuration, type CallConversationItem } from "./conversationTypes";

/**
 * Compact directional call pill. The info popover
 * reveals all recorded details and media using the existing playback contracts.
 */
export const CallHistoryItem: React.FC<{
  item: CallConversationItem;
  /** Agency disposition colors keyed by normalizeDispositionValue(name); absent/unmatched → neutral text. */
  dispositionColors?: Record<string, string>;
}> = ({ item, dispositionColors }) => {
  const { formatDateTime } = useBranding();
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
    : item.dispositionName || (item.inboundOutcomeLabel !== "Inbound call" ? item.inboundOutcomeLabel : null) || item.outcome || item.status || "Not recorded";
  return (
    <CommunicationHistoryPill
      outbound={item.outbound}
      label={item.directionLabel ? `${item.directionLabel} Call` : "Call"}
      detailsLabel="Call details"
      icon={DirectionIcon}
      iconClassName="text-emerald-600 dark:text-emerald-400"
      timestampMs={item.timestampMs}
      timestampKnown={item.timestampKnown}
      summary={
        <span
          className={cn("min-w-0 truncate !bg-transparent text-[11px]", item.inboundMissed ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}
          style={!item.inboundMissed && dispositionColor ? getStatusColorStyle(dispositionColor) : undefined}
          title={summary}
        >{summary}</span>
      }
    >
      <div className="space-y-2">
        <DetailsPanel id={`${panelId}-metadata`} rows={rows} missingLabel="Not recorded" />
        {item.recordingAvailable ? (
          <section aria-label="Call recording" className="rounded-lg border border-border bg-muted/40 p-2">
            <p className="mb-1 text-[10px] font-medium text-muted-foreground">Recording</p>
            <RecordingPlayer callId={item.id} compact />
          </section>
        ) : null}
        {item.voicemailId ? (
          <section aria-label="Call voicemail" className="rounded-lg border border-border bg-muted/40 p-2">
            <p className="mb-1 text-[10px] font-medium text-muted-foreground">Voicemail</p>
            <VoicemailPlayer voicemailId={item.voicemailId} compact />
          </section>
        ) : null}
      </div>
    </CommunicationHistoryPill>
  );
};
