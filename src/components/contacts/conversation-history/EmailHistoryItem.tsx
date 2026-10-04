import React, { useId } from "react";
import { Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBranding } from "@/contexts/BrandingContext";
import { DetailsPanel, type DetailRow } from "./CommunicationDetails";
import { CommunicationHistoryPill } from "./CommunicationHistoryPill";
import type { EmailConversationItem } from "./conversationTypes";

/**
 * Compact directional email pill. An info popover preserves the full subject,
 * body and metadata; outbound icons sit on the user side, inbound on the left.
 */
export const EmailHistoryItem: React.FC<{ item: EmailConversationItem }> = ({ item }) => {
  const { formatDateTime } = useBranding();
  const panelId = useId();

  const subjectLine = item.subject && item.subject.trim() ? item.subject.trim() : "(No subject)";
  const bodyLines = item.body.split("\n");

  const rows: DetailRow[] = [
    { label: "From", value: item.fromEmail },
    { label: "To", value: item.toEmails.length ? item.toEmails.join(", ") : null },
    ...(item.ccEmails.length ? [{ label: "CC", value: item.ccEmails.join(", ") }] : []),
    ...(item.bccEmails.length ? [{ label: "BCC", value: item.bccEmails.join(", ") }] : []),
    { label: "Direction", value: item.outbound ? "Outbound" : "Inbound" },
    {
      label: item.outbound ? "Sent" : "Received",
      value: item.timestampKnown !== false && Number.isFinite(item.timestampMs) ? formatDateTime(new Date(item.timestampMs)) : null,
    },
    { label: "Delivery status", value: item.deliveryStatus },
  ];

  return (
    <CommunicationHistoryPill
      outbound={item.outbound}
      label={item.outbound ? "Outbound Email" : "Inbound Email"}
      detailsLabel="Email details"
      icon={Mail}
      iconClassName="text-violet-500"
      timestampMs={item.timestampMs}
      timestampKnown={item.timestampKnown}
      summary={<span className="min-w-0 truncate text-[11px] text-muted-foreground" title={item.deliveryStatus || "Not recorded"}>{item.deliveryStatus || "Not recorded"}</span>}
    >
      <div className="space-y-2">
        <div className="rounded-lg border border-border p-3">
          <p className="mb-2 break-words text-sm font-medium text-foreground [overflow-wrap:anywhere]">{subjectLine}</p>
          {bodyLines.map((line, i) => (
            <p key={i} className={cn("min-h-[1em] whitespace-pre-wrap break-words text-xs leading-relaxed [overflow-wrap:anywhere]", line.startsWith(">") ? "text-muted-foreground" : "text-foreground")}>
              {line}
            </p>
          ))}
        </div>
        <DetailsPanel id={`${panelId}-metadata`} rows={rows} />
      </div>
    </CommunicationHistoryPill>
  );
};
