import React from "react";
import { ChevronDown, ChevronRight, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  /** Display title (sentence case). Also names the export button: "Export {title} CSV". */
  title: string;
  defaultOpen?: boolean;
  /** Present only when the viewer may export (server `can_export`); omitted otherwise. */
  onExport?: () => void;
  children: React.ReactNode;
  /** One short line about how the numbers read (coverage, inbound); beside the title, below it on phones. */
  meta?: React.ReactNode;
}

const ReportSection: React.FC<Props> = ({ title, defaultOpen = true, onExport, children, meta }) => {
  const [open, setOpen] = React.useState(defaultOpen);
  const id = React.useId();
  const titleId = `${id}-title`;
  const contentId = `${id}-content`;

  return (
    <section className="rounded-xl border border-border/60 bg-card">
      <div className="flex items-center gap-2 px-4 py-2 sm:px-5">
        <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-3">
          <h3 className={cn("min-w-0 text-sm font-semibold tracking-tight", meta ? "sm:flex-[1_0_auto]" : "sm:flex-1")}>
            <button type="button" id={titleId} aria-expanded={open} aria-controls={contentId}
              onClick={() => setOpen((value) => !value)}
              className="flex min-h-10 w-full items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              {open ? <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />}
              <span className="break-words">{title}</span>
            </button>
          </h3>
          {meta && <div className="pl-6 text-xs tabular-nums text-muted-foreground sm:pl-0 sm:text-right">{meta}</div>}
        </div>
        {onExport && (
          <Button type="button" variant="ghost" size="sm" aria-label={`Export ${title} CSV`}
            className="h-8 shrink-0 gap-1.5 px-2 text-xs text-muted-foreground" onClick={onExport}>
            <Download aria-hidden="true" className="h-3.5 w-3.5" />CSV
          </Button>
        )}
      </div>
      <div id={contentId} role="region" aria-labelledby={titleId} hidden={!open}>
        {open && <div className="px-4 pb-4 sm:px-5">{children}</div>}
      </div>
    </section>
  );
};

export default ReportSection;
