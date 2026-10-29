import React from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface FilterChip<T extends string> {
  id: T;
  label: string;
  /** Count shown after the label; a string allows "at least" counts ("12+"). */
  count?: number | string;
  icon?: React.ElementType;
}

/** Toggle buttons (`aria-pressed`) in a labelled group. */
export function DashboardFilterChips<T extends string>({
  label,
  chips,
  value,
  onChange,
}: {
  label: string;
  chips: FilterChip<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {chips.map((chip) => {
        const Icon = chip.icon;
        const pressed = value === chip.id;
        return (
          <Button
            key={chip.id}
            type="button"
            size="sm"
            variant={pressed ? "default" : "outline"}
            aria-pressed={pressed}
            className={
              "h-8 gap-1.5 rounded-lg px-3 text-xs transition-colors motion-reduce:transition-none " +
              (pressed ? "shadow-sm" : "text-muted-foreground hover:text-foreground")
            }
            onClick={() => onChange(chip.id)}
          >
            {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
            <span className="tabular-nums">{chip.count === undefined ? chip.label : `${chip.label} (${chip.count})`}</span>
          </Button>
        );
      })}
    </div>
  );
}

/** Search over the rows already loaded (the label says so). */
export const DashboardSearchInput: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
}> = ({ label, value, onChange }) => (
  <div className="relative">
    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
    <Input
      aria-label={label}
      placeholder={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-9 rounded-lg pl-9 text-sm"
    />
  </div>
);
