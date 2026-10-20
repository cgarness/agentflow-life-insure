import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { CenterContact } from "@/lib/commission/centerSchemas";
import { contactName, type ChipTone } from "./format";

/** The one compact definition control: opens on click or tap, never a paragraph under a heading. */
export function InfoTip({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={label}
          className={cn("rounded-full p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}>
          <Info className="h-3.5 w-3.5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72 p-3 text-xs leading-relaxed">{children}</PopoverContent>
    </Popover>
  );
}

export function Chip({ tone, children }: { tone: ChipTone; children: React.ReactNode }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
      tone === "positive" && "bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300",
      tone === "attention" && "bg-amber-500/10 text-amber-800 ring-amber-500/30 dark:text-amber-200",
      tone === "neutral" && "bg-primary/10 text-primary ring-primary/20",
      tone === "muted" && "bg-muted text-muted-foreground ring-border",
    )}>
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full",
        tone === "positive" && "bg-emerald-500", tone === "attention" && "bg-amber-500", tone === "neutral" && "bg-primary",
        tone === "muted" && "bg-muted-foreground/60")} />
      {children}
    </span>
  );
}

export function PolicyIdentity({ contact, detail }: { contact: CenterContact; detail: string }) {
  return (
    <span className="min-w-0">
      <span className={cn("block truncate text-sm font-medium", contact ? "text-foreground" : "italic text-muted-foreground")}>{contactName(contact)}</span>
      <span className="block truncate text-xs text-muted-foreground">{detail}</span>
    </span>
  );
}

/** "1–25 of 80" with Previous / Next. */
export function Pager({ page, pageSize, total, onPage, label }: { page: number; pageSize: number; total: number; onPage: (page: number) => void; label: string }) {
  if (total <= pageSize) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return (
    <nav aria-label={label} className="flex items-center justify-between gap-3 px-1 pt-3 text-xs text-muted-foreground">
      <span className="tabular-nums">{first}–{last} of {total}</span>
      <span className="flex gap-2">
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}
          className="h-8 rounded-md border border-border px-3 text-foreground hover:bg-muted disabled:opacity-40">Previous</button>
        <button type="button" disabled={last >= total} onClick={() => onPage(page + 1)}
          className="h-8 rounded-md border border-border px-3 text-foreground hover:bg-muted disabled:opacity-40">Next</button>
      </span>
    </nav>
  );
}

/** A select styled like the app's compact filter controls (native, so it works the same on phones). */
export function FilterSelect<T extends string>({ label, value, options, onChange, className }: {
  label: string; value: T; options: ReadonlyArray<readonly [T, string]>; onChange: (value: T) => void; className?: string;
}) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1 text-xs font-medium text-muted-foreground", className)}>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value as T)}
        className="h-9 min-w-0 rounded-lg border border-input bg-background px-2.5 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring">
        {options.map(([option, text]) => <option key={option} value={option}>{text}</option>)}
      </select>
    </label>
  );
}
