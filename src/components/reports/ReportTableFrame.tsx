import React from "react";
import { cn } from "@/lib/utils";

interface Props {
  /** Names the scrolling region for assistive technology, e.g. "Agent performance table". */
  label: string;
  /** Screen-reader caption; defaults to the label. */
  caption?: string;
  /** Minimum table width (a Tailwind class such as "min-w-[820px]"), so narrow screens scroll, not squash. */
  tableClassName?: string;
  /** thead, tbody and tfoot. */
  children: React.ReactNode;
}

/**
 * ReportTableFrame — the one frame every Reports table scrolls in: a labelled, keyboard-focusable region
 * (arrow keys scroll it) with the table as its direct child. Below sm a right-edge fade, a sibling of the
 * scroller so it never scrolls away, says there is more to the right.
 */
const ReportTableFrame: React.FC<Props> = ({ label, caption, tableClassName, children }) => (
  <div className="relative min-w-0">
    <div role="region" aria-label={label} tabIndex={0}
      className="min-w-0 overflow-x-auto overscroll-x-contain rounded-lg border border-border/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <table className={cn("w-full border-separate border-spacing-0 text-sm [&>tbody>tr:last-child>*]:border-b-0", tableClassName)}>
        <caption className="sr-only">{caption ?? label}</caption>
        {children}
      </table>
    </div>
    <div aria-hidden="true" data-scroll-fade=""
      className="pointer-events-none absolute inset-y-px right-px w-6 rounded-r-lg bg-gradient-to-l from-card to-transparent sm:hidden" />
  </div>
);

export default ReportTableFrame;
