import React, { useEffect, useRef, useState } from "react";
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

/** True while the scroller can still scroll right: columns remain beyond its right edge. */
function useMoreToTheRight(ref: React.RefObject<HTMLDivElement>): boolean {
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    // The table's own size changes with its rows and columns; the scroller's with the layout.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(el);
    if (el.firstElementChild) observer?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, [ref]);
  return more;
}

/**
 * ReportTableFrame — the one frame every Reports table scrolls in: a labelled, keyboard-focusable region
 * (arrow keys scroll it) with the table as its direct child. At every width, while columns remain to the
 * right, a right-edge fade (a sibling of the scroller, so it never scrolls away) says there is more; it
 * leaves once the last column is in view, so it never claims columns that are not there.
 */
const ReportTableFrame: React.FC<Props> = ({ label, caption, tableClassName, children }) => {
  const scroller = useRef<HTMLDivElement>(null);
  const more = useMoreToTheRight(scroller);
  return (
    <div className="relative min-w-0">
      <div ref={scroller} role="region" aria-label={label} tabIndex={0}
        className="min-w-0 overflow-x-auto overscroll-x-contain rounded-lg border border-border/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <table className={cn("w-full border-separate border-spacing-0 text-sm [&>tbody>tr:last-child>*]:border-b-0", tableClassName)}>
          <caption className="sr-only">{caption ?? label}</caption>
          {children}
        </table>
      </div>
      <div aria-hidden="true" data-scroll-fade=""
        className={cn("pointer-events-none absolute inset-y-px right-px w-6 rounded-r-lg bg-gradient-to-l from-card to-transparent", !more && "hidden")} />
    </div>
  );
};

export default ReportTableFrame;
