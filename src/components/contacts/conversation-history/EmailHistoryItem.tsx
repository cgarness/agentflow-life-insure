import React, { useId, useState } from "react";
import { Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBranding } from "@/contexts/BrandingContext";
import { DetailsPanel, DetailsToggleButton, type DetailRow } from "./CommunicationDetails";
import type { EmailConversationItem } from "./conversationTypes";

/**
 * Compact neutral email summary. A single disclosure preserves the full subject,
 * body and metadata; outbound icons sit on the user side, inbound on the left.
 */
export const EmailHistoryItem: React.FC<{ item: EmailConversationItem }> = ({ item }) => {
  const { formatDateTime } = useBranding();
  const [detailsOpen, setDetailsOpen] = useState(false);
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
      value: item.timestampMs ? formatDateTime(new Date(item.timestampMs)) : null,
    },
    { label: "Delivery status", value: item.deliveryStatus },
  ];

  return (
    <div className="w-full min-w-0 rounded-lg border border-border bg-card px-3 py-2">
      <div className={cn("flex items-start gap-2 min-w-0", item.outbound && "flex-row-reverse")}>
        <span className="mt-0.5 w-6 h-6 rounded-full bg-violet-500/10 flex items-center justify-center shrink-0">
          <Mail className="w-3.5 h-3.5 text-violet-500" aria-hidden />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-semibold text-foreground">{item.outbound ? "Outbound Email" : "Inbound Email"}</span>
            <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
              {item.timestampKnown === false ? "Date not recorded" : formatDateTime(new Date(item.timestampMs))}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2 min-w-0">
            <p className="flex-1 min-w-0 truncate text-xs text-muted-foreground" title={subjectLine}>{subjectLine}</p>
            <DetailsToggleButton open={detailsOpen} onClick={() => setDetailsOpen((open) => !open)} panelId={panelId} label="Email details" />
          </div>
        </div>
      </div>
      {detailsOpen ? (
        <div id={panelId} className="mt-2 space-y-2">
          <div className="rounded-lg border border-border p-3 max-h-[min(60vh,28rem)] overflow-y-auto">
            <p className="text-sm font-medium text-foreground mb-2 break-words [overflow-wrap:anywhere]">{subjectLine}</p>
            {bodyLines.map((line, i) => (
              <p key={i} className={cn("text-xs leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere] min-h-[1em]", line.startsWith(">") ? "text-muted-foreground" : "text-foreground")}>
                {line}
              </p>
            ))}
          </div>
          <DetailsPanel id={`${panelId}-metadata`} rows={rows} />
        </div>
      ) : null}
    </div>
  );
};
