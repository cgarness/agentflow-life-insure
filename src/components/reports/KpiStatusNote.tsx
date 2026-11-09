import React, { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  lines: string[];
  tone: "partial" | "progress";
}

/** A text chip that opens its on-demand lines (D6 §4.3). Keyboard: Enter/Space toggles, Escape closes. */
const KpiStatusNote: React.FC<Props> = ({ label, lines, tone }) => {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  return (
    <span ref={root} className="relative inline-flex">
      <button type="button" aria-expanded={open} aria-controls={id}
        onClick={() => setOpen(o => !o)} onKeyDown={e => { if (e.key === "Escape") setOpen(false); }}
        className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          tone === "partial" ? "border-amber-600/50 text-amber-800 dark:text-amber-300" : "border-sky-600/50 text-sky-800 dark:text-sky-300")}>
        {label}
      </button>
      {open && (
        <span id={id} role="note" onKeyDown={e => { if (e.key === "Escape") setOpen(false); }}
          className="absolute left-0 top-full z-30 mt-1.5 w-64 rounded-lg border border-border bg-popover p-3 text-xs leading-5 text-popover-foreground shadow-lg">
          {lines.map(line => <span key={line} className="block">{line}</span>)}
        </span>
      )}
    </span>
  );
};

export default KpiStatusNote;
