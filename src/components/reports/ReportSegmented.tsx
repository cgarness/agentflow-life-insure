import { cn } from "@/lib/utils";

interface Props<T extends string> {
  /** Names the group for assistive technology, e.g. "Group trends by". */
  ariaLabel: string;
  value: T;
  onChange: (value: T) => void;
  /** [value, visible label] pairs, in display order. */
  options: ReadonlyArray<readonly [T, string]>;
  className?: string;
}

/**
 * One segmented control for every Reports view switch: a labelled `role="group"` of buttons whose
 * `aria-pressed` states which option is on (U-4), so the selected state is never colour alone.
 */
export default function ReportSegmented<T extends string>({ ariaLabel, value, onChange, options, className }: Props<T>) {
  return (
    <div role="group" aria-label={ariaLabel} className={cn("inline-flex h-9 shrink-0 items-center rounded-lg bg-muted/60 p-0.5", className)}>
      {options.map(([option, label]) => {
        const on = option === value;
        return (
          <button key={option} type="button" aria-pressed={on} onClick={() => onChange(option)}
            className={cn(
              "h-8 rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground",
            )}>
            {label}
          </button>
        );
      })}
    </div>
  );
}
