import React, { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { type CatalogOption, type MissingStandardField } from "@/lib/google-sheets/fieldCatalog";
import { IGNORE_TARGET } from "@/lib/google-sheets/headerState";

export const IGNORE = IGNORE_TARGET;
/** Sorting affects picker display only, never a stored mapping or server field order. */
const FIELD_ORDER = new Intl.Collator("en", { sensitivity: "base" });
type PickerEntry =
  | { kind: "field"; value: string; label: string; option: CatalogOption }
  | { kind: "standard"; value: string; label: string; standard: MissingStandardField };
const matchKeywords = (_value: string, search: string, keywords?: string[]) => {
  const q = search.toLowerCase().replace(/[^a-z0-9]/g, "");
  return !q || (keywords ?? []).some((k) => k.toLowerCase().replace(/[^a-z0-9]/g, "").includes(q)) ? 1 : 0;
};

interface Props {
  header: string;
  value: string;                       // target, or IGNORE
  options: CatalogOption[];
  missingStandard: MissingStandardField[];
  usedBy: Map<string, string>;         // target → header currently using it
  onSelect: (target: string) => void;
  onCreate: (suggestedName: string) => void;
  disabled?: boolean;
}

/** Compact A–Z field picker. Disabled options retain accessible reasons and cannot be selected. */
const MappingFieldPicker: React.FC<Props> = ({ header, value, options, missingStandard, usedBy, onSelect, onCreate, disabled }) => {
  const [open, setOpen] = useState(false);
  const current = value === IGNORE ? null : options.find((o) => o.value === value);
  const pick = (v: string) => { setOpen(false); onSelect(v); };
  const label = current?.label ?? (value === IGNORE ? "Don't import" : "Choose a field");
  const entries = useMemo((): PickerEntry[] => {
    const all: PickerEntry[] = [
      ...options.map((option) => ({ kind: "field" as const, value: option.value, label: option.label, option })),
      ...missingStandard.map((standard) => ({ kind: "standard" as const, value: `std-${standard.key}`, label: standard.name, standard })),
    ];
    return all.sort((a, b) => FIELD_ORDER.compare(a.label, b.label) || a.value.localeCompare(b.value));
  }, [options, missingStandard]);


  return (
    <Popover open={open && !disabled} onOpenChange={(o) => setOpen(o && !disabled)} modal>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={open} aria-label={`Field for ${header}`} disabled={disabled}
          className={cn("h-9 w-full justify-between px-3 text-sm font-normal", value === IGNORE && "text-muted-foreground")}>
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="z-[1100] w-[--radix-popover-trigger-width] min-w-[16rem] p-0" align="start">
        <Command filter={matchKeywords}>
          <CommandInput placeholder="Search fields…" className="h-9" />
          <CommandList className="max-h-72">
            <CommandEmpty>No matching field.</CommandEmpty>
            <CommandItem value={IGNORE} keywords={["don't import", "ignore", "skip"]} onSelect={() => pick(IGNORE)}>
              <Check className={cn("mr-2 h-4 w-4 shrink-0", value === IGNORE ? "opacity-100" : "opacity-0")} aria-hidden />
              Don't import
            </CommandItem>
            <CommandSeparator />
            {entries.map((entry) => {
              if (entry.kind === "standard") {
                const standard = entry.standard;
                return (
                  <CommandItem key={entry.value} value={entry.value} keywords={[standard.name, "add standard field"]}
                    aria-label={`Add ${standard.name} standard field`}
                    title={`Add ${standard.name} as an agency-wide field`}
                    onSelect={() => { setOpen(false); onCreate(standard.name); }}>
                    <Plus className="mr-2 h-4 w-4 shrink-0" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-sm">{standard.name}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground" aria-hidden>Add</span>
                  </CommandItem>
                );
              }
              const o = entry.option;
              const used = usedBy.get(o.value);
              const elsewhere = used !== undefined && used !== header;
              return (
                <CommandItem key={o.value} value={o.value} keywords={[o.label, ...o.keywords]}
                  disabled={o.disabled} title={o.reason ?? (elsewhere ? `Mapped to “${used}”` : undefined)}
                  onSelect={() => pick(o.value)}>
                  <Check className={cn("mr-2 h-4 w-4 shrink-0", value === o.value ? "opacity-100" : "opacity-0")} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-sm">{o.label}</span>
                  {o.type && o.type !== "Text" && <span className="shrink-0 text-[11px] text-muted-foreground">{o.type}</span>}
                  {o.disabled
                    ? <span className="shrink-0 text-[11px] text-muted-foreground">Unavailable</span>
                    : elsewhere && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground" aria-hidden>In use</span>}
                  {o.reason && <span className="sr-only"> {o.reason}</span>}
                  {elsewhere && <span className="sr-only"> Used by “{used}”</span>}
                </CommandItem>
              );
            })}
            <CommandSeparator />
            <CommandItem value="__create__" keywords={["create", "new", "custom", header]}
              onSelect={() => { setOpen(false); onCreate(header); }}>
              <Plus className="mr-2 h-4 w-4 shrink-0" aria-hidden />
              Create custom field…
            </CommandItem>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default MappingFieldPicker;
