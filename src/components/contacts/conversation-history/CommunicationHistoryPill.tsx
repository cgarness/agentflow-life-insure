import React, { useState } from "react";
import { PopoverAnchor } from "@radix-ui/react-popover";
import { Info, X, type LucideIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useBranding } from "@/contexts/BrandingContext";
import { cn } from "@/lib/utils";

interface CommunicationHistoryPillProps {
  outbound: boolean;
  label: string;
  detailsLabel: string;
  icon: LucideIcon;
  iconClassName: string;
  summary: React.ReactNode;
  timestampMs: number;
  timestampKnown?: boolean;
  children: React.ReactNode;
}

/** Content-width communication summary; source data and media stay with the caller. */
export function CommunicationHistoryPill({
  outbound, label, detailsLabel, icon: Icon, iconClassName, summary,
  timestampMs, timestampKnown, children,
}: CommunicationHistoryPillProps) {
  const [open, setOpen] = useState(false);
  const { formatDateTime } = useBranding();
  const known = timestampKnown !== false && Number.isFinite(new Date(timestampMs).getTime());
  const date = known ? new Date(timestampMs) : null;
  const fullTime = date ? formatDateTime(date) : "Date not recorded";

  return (
    <div className={cn("flex min-w-0 shrink-0", outbound ? "justify-end" : "justify-start")}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div className={cn(
            "inline-flex w-fit max-w-full min-w-0 items-center gap-1.5 rounded-full py-0.5 text-xs",
            outbound ? "flex-row-reverse bg-blue-500/[0.08] pl-1 pr-3" : "bg-muted pl-3 pr-1",
          )}>
            <Icon className={cn("h-3.5 w-3.5 shrink-0", iconClassName)} aria-hidden />
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="shrink-0 whitespace-nowrap font-medium text-foreground">{label}</span>
              <span className="text-muted-foreground" aria-hidden>·</span>
              {summary}
              <time dateTime={date?.toISOString()} title={fullTime} aria-label={fullTime} className="shrink-0 whitespace-nowrap text-[10px] text-muted-foreground">
                {date ? formatDateTime(date, { hideDate: true }) : "Not recorded"}
              </time>
            </div>
            <PopoverTrigger asChild>
              <button type="button" aria-label={detailsLabel} title={detailsLabel} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
                <Info className="h-3.5 w-3.5" aria-hidden />
              </button>
            </PopoverTrigger>
          </div>
        </PopoverAnchor>
        <PopoverContent
          align={outbound ? "end" : "start"}
          sideOffset={8}
          collisionPadding={12}
          aria-label={detailsLabel}
          onEscapeKeyDown={(event) => event.stopPropagation()}
          className="w-80 max-w-[calc(100vw-2rem)] max-h-[min(70vh,var(--radix-popover-content-available-height))] overflow-y-auto overscroll-contain rounded-xl p-3"
        >
          {open ? <>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-medium">{label}</p>
              <button type="button" aria-label={`Close ${detailsLabel.toLowerCase()}`} onClick={() => setOpen(false)} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
            {children}
          </> : null}
        </PopoverContent>
      </Popover>
    </div>
  );
}
