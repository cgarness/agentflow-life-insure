import React from "react";
import { ChevronDown, ChevronRight, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  title: string;
  defaultOpen?: boolean;
  /** Present only when the viewer may export (server `can_export`); omitted otherwise. */
  onExport?: () => void;
  children: React.ReactNode;
  badge?: string;
}

const ReportSection: React.FC<Props> = ({ title, defaultOpen = true, onExport, children, badge }) => {
  const [open, setOpen] = React.useState(defaultOpen);
  const id = React.useId();
  const titleId = `${id}-title`;
  const contentId = `${id}-content`;

  return (
    <section className="rounded-xl border border-border/60 bg-card">
      <div className="flex items-center gap-2 px-4 py-3 sm:px-5">
        <h3 className="min-w-0 flex-1 text-base font-semibold tracking-tight">
          <button type="button" id={titleId} aria-expanded={open} aria-controls={contentId}
            onClick={() => setOpen((value) => !value)}
            className="flex w-full items-center gap-2 rounded-md py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
            {open ? <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />}
            <span className="break-words">{title}</span>
          </button>
        </h3>
        {badge && <span className="rounded-md bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">{badge}</span>}
        {onExport && (
          <Button type="button" variant="ghost" size="sm" aria-label={`Export ${title} CSV`}
            className="shrink-0 gap-1.5 text-xs text-muted-foreground" onClick={onExport}>
            <Download aria-hidden="true" className="h-3.5 w-3.5" />CSV
          </Button>
        )}
      </div>
      <div id={contentId} role="region" aria-labelledby={titleId} hidden={!open}>
        {open && <div className="px-4 pb-5 sm:px-5">{children}</div>}
      </div>
    </section>
  );
};

export default ReportSection;
