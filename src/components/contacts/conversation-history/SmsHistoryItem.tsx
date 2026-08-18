import React, { useId, useState } from "react";
import { MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBranding } from "@/contexts/BrandingContext";
import { formatPhoneNumber } from "@/utils/phoneUtils";
import { DetailsPanel, DetailsToggleButton, type DetailRow } from "./CommunicationDetails";
import type { SmsConversationItem } from "./conversationTypes";

/**
 * iPhone-style SMS bubble — the only Conversation History channel that keeps
 * chat alignment. Outbound = blue `#007AFF` (documented intentional literal);
 * inbound = token-based neutral surface (dark-mode-correct by construction).
 */
export const SmsHistoryItem: React.FC<{ item: SmsConversationItem }> = ({ item }) => {
  const { formatDateTime } = useBranding();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const panelId = useId();

  const rows: DetailRow[] = [
    { label: "From", value: item.fromNumber ? formatPhoneNumber(item.fromNumber) : null },
    { label: "To", value: item.toNumber ? formatPhoneNumber(item.toNumber) : null },
    { label: "Direction", value: item.outbound ? "Outbound" : "Inbound" },
    { label: "Sent", value: item.timestampMs ? formatDateTime(new Date(item.timestampMs)) : null },
    { label: "Status", value: item.status },
  ];

  return (
    <div className={cn("flex flex-col w-full", item.outbound ? "items-end" : "items-start")}>
      <div className={cn("flex items-end gap-2 max-w-[85%] min-w-0", item.outbound ? "flex-row-reverse" : "flex-row")}>
        <div className="shrink-0 mb-1">
          <MessageSquare className="w-3.5 h-3.5 text-blue-500 opacity-70" aria-hidden />
        </div>
        <div className={cn("flex flex-col min-w-0", item.outbound ? "items-end" : "items-start")}>
          <div
            className={cn(
              "px-3.5 py-2 rounded-2xl text-sm shadow-sm min-w-0 max-w-full",
              item.outbound
                ? "bg-[#007AFF] text-white rounded-tr-sm"
                : "bg-muted border border-border text-foreground rounded-tl-sm",
            )}
          >
            {/* [overflow-wrap:anywhere] (unlike break-word) counts in min-content sizing, so an
                unbroken string cannot widen the bubble past the column on narrow layouts. */}
            <p className="leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{item.body}</p>
          </div>
          <div
            className={cn(
              "text-[10px] text-muted-foreground mt-1 px-1 flex items-center gap-2",
              item.outbound ? "justify-end" : "justify-start",
            )}
          >
            <span>{formatDateTime(new Date(item.timestampMs))}</span>
            <DetailsToggleButton
              open={detailsOpen}
              onClick={() => setDetailsOpen((o) => !o)}
              panelId={panelId}
              label="SMS details"
            />
          </div>
        </div>
      </div>
      {detailsOpen ? (
        <div className={cn("mt-1 w-full max-w-[min(85%,24rem)]", item.outbound ? "self-end" : "self-start")}>
          <DetailsPanel id={panelId} rows={rows} />
        </div>
      ) : null}
    </div>
  );
};
