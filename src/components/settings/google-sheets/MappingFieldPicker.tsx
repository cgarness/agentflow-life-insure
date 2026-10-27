import React, { useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { GROUP_LABELS, type CatalogGroup, type CatalogOption, type MissingStandardField } from "@/lib/google-sheets/fieldCatalog";
import { IGNORE_TARGET } from "@/lib/google-sheets/headerState";

export const IGNORE = IGNORE_TARGET;
const ORDER: CatalogGroup[] = ["required", "contact", "details", "address", "agency", "mine", "others", "unavailable"];
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

/** Searchable, grouped field picker for one sheet column. Unavailable fields are listed (disabled) with the reason. */
const MappingFieldPicker: React.FC<Props> = ({ header, value, options, missingStandard, usedBy, onSelect, onCreate, disabled }) => {
  const [open, setOpen] = useState(false);
  const current = value === IGNORE ? null : options.find((o) => o.value === value);
  const pick = (v: string) => { setOpen(false); onSelect(v); };
  const label = current?.label ?? (value === IGNORE ? "Don't import" : "Choose a field");

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
            <CommandGroup>
              <CommandItem value={IGNORE} keywords={["don't import", "ignore", "skip"]} onSelect={() => pick(IGNORE)}>
                <Check className={cn("mr-2 h-4 w-4", value === IGNORE ? "opacity-100" : "opacity-0")} aria-hidden />
                Don't import
              </CommandItem>
            </CommandGroup>
            {ORDER.map((g) => {
              const items = options.filter((o) => o.group === g);
              const missing = g === "address" ? missingStandard : [];
              if (!items.length && !missing.length) return null;
              return (
                <CommandGroup key={g} heading={GROUP_LABELS[g]}>
                  {items.map((o) => {
                    const used = usedBy.get(o.value);
                    const elsewhere = used !== undefined && used !== header;
                    return (
                      <CommandItem key={o.value} value={o.value} keywords={[o.label, ...o.keywords]} disabled={o.disabled} onSelect={() => pick(o.value)}>
                        <Check className={cn("mr-2 h-4 w-4 shrink-0", value === o.value ? "opacity-100" : "opacity-0")} aria-hidden />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate">{o.label}{o.type && o.type !== "Text" && <span className="ml-2 text-xs text-muted-foreground">{o.type}</span>}</span>
                          {(o.reason || elsewhere) && (
                            <span className="truncate text-xs text-muted-foreground">{elsewhere ? `Used by “${used}”` : o.reason}</span>
                          )}
                        </span>
                      </CommandItem>
                    );
                  })}
                  {missing.map((m) => (
                    <CommandItem key={`std-${m.key}`} value={`std-${m.key}`} keywords={[m.name]} onSelect={() => { setOpen(false); onCreate(m.name); }}>
                      <Plus className="mr-2 h-4 w-4 shrink-0" aria-hidden />
                      <span className="truncate">{m.name}<span className="ml-2 text-xs text-muted-foreground">add standard field</span></span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}
            <CommandSeparator />
            <CommandGroup>
              <CommandItem value="__create__" keywords={["create", "new", "custom", header]} onSelect={() => { setOpen(false); onCreate(header); }}>
                <Plus className="mr-2 h-4 w-4" aria-hidden />
                Create custom field…
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default MappingFieldPicker;
