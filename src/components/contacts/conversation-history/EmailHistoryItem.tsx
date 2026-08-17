import React, { useId, useState } from "react";
import { ChevronDown, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBranding } from "@/contexts/BrandingContext";
import { DetailsPanel, DetailsToggleButton, type DetailRow } from "./CommunicationDetails";
import type { EmailConversationItem } from "./conversationTypes";

/**
 * Compact neutral email card — deliberately NOT a chat bubble. Preserves the
 * previous body expand/collapse behavior including `>`-quoted-line dimming and
 * the capped scrollable body region.
 */
export const EmailHistoryItem: React.FC<{ item: EmailConversationItem }> = ({ item }) => {
  const { formatDateTime } = useBranding();
  const [bodyOpen, setBodyOpen] = useState(false);
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
    <div className="w-full min-w-0 rounded-lg border border-border bg-card shadow-sm px-3.5 py-2.5">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="w-7 h-7 rounded-full bg-violet-500/10 flex items-center justify-center shrink-0">
          <Mail className="w-3.5 h-3.5 text-violet-500" aria-hidden />
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground shrink-0">
          Email · {item.outbound ? "Outbound" : "Inbound"}
        </span>
        <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
          {formatDateTime(new Date(item.timestampMs))}
        </span>
      </div>

      <button
        type="button"
        onClick={() => setBodyOpen((o) => !o)}
        aria-expanded={bodyOpen}
        aria-label={bodyOpen ? "Hide full email" : `Show full email: ${subjectLine}`}
        className="mt-1.5 w-full flex items-start gap-2 text-left rounded transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex-1 text-sm font-medium text-foreground min-w-0 line-clamp-2 break-words" title={subjectLine}>
          {subjectLine}
        </span>
        <ChevronDown
          className={cn("w-3.5 h-3.5 shrink-0 mt-0.5 text-muted-foreground transition-transform duration-200", bodyOpen && "rotate-180")}
          aria-hidden
        />
      </button>

      <p className="mt-0.5 text-xs text-muted-foreground truncate">
        {`From ${item.fromEmail || "—"} · To ${item.toEmails.length ? item.toEmails.join(", ") : "—"}`}
      </p>

      {bodyOpen ? (
        <div className="mt-2 pt-2 border-t border-border/50 max-h-[min(60vh,28rem)] overflow-y-auto animate-in fade-in slide-in-from-top-1 duration-200">
          {bodyLines.map((line, i) =>
            line.startsWith(">") ? (
              <p key={i} className="text-[11px] leading-relaxed text-muted-foreground break-words">
                {line}
              </p>
            ) : (
              <p key={i} className="text-sm leading-relaxed text-foreground break-words">
                {line}
              </p>
            ),
          )}
        </div>
      ) : null}

      <div className="mt-1.5">
        <DetailsToggleButton
          open={detailsOpen}
          onClick={() => setDetailsOpen((o) => !o)}
          panelId={panelId}
          label="Email details"
        />
      </div>

      {detailsOpen ? <DetailsPanel id={panelId} rows={rows} className="mt-2" /> : null}
    </div>
  );
};
