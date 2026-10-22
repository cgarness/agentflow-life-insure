import { useEffect, useState } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { OrganizationCarriers } from "@/hooks/useOrganizationCarriers";
import { preservedCarrierOption } from "@/lib/carrierSelection";

interface CarrierComboboxProps {
  /** Trigger id, for the field's <label htmlFor>. */
  id: string;
  value: string;
  onChange: (value: string) => void;
  list: OrganizationCarriers;
  /** The exact carrier stored on the client being edited; kept selectable until replaced. Never search text. */
  preserved?: string | null;
  /** The form is locked or saving: no opening, no selection. */
  disabled?: boolean;
  /** Offer "No carrier" to clear a chosen value (where a blank carrier is already allowed). */
  allowClear?: boolean;
  className?: string;
}

// cmdk item values are opaque ids so a saved case-variant never collides with its configured carrier;
// matching uses the item's keywords (the carrier name), case-insensitively.
const matchName = (_value: string, search: string, keywords?: string[]) =>
  (keywords ?? []).some((k) => k.toLowerCase().includes(search.trim().toLowerCase())) ? 1 : 0;

/**
 * Searchable carrier picker fed only by Settings → Carriers. No automatic selection and no typed carrier creation.
 */
export function CarrierCombobox({ id, value, onChange, list, preserved, disabled = false, allowClear = false, className }: CarrierComboboxProps) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  const configured = list.carriers ?? [];
  const saved = preservedCarrierOption(list.carriers, preserved);
  const canOpen = !disabled && list.status === "ready" && (configured.length > 0 || saved !== null);
  const select = (next: string) => {
    if (disabled) return;
    onChange(next);
    setOpen(false);
  };
  const flagged = saved !== null && value === saved.value && saved.notInSettings;
  const label = value.trim() ? value : list.status === "loading" ? "Loading carriers…" : "Select carrier…";

  return (
    <div className="space-y-1">
      <Popover open={open && canOpen} onOpenChange={(next) => setOpen(next && canOpen)} modal>
        <PopoverTrigger asChild>
          <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open && canOpen} disabled={!canOpen}
            title={value.trim() ? value : undefined} aria-describedby={flagged ? `${id}-saved` : undefined}
            className={cn("h-9 w-full justify-between border-border bg-muted px-3 text-sm font-normal text-foreground hover:bg-muted/80", !value.trim() && "text-muted-foreground", className)}>
            <span className="truncate">{label}</span>
            {list.status === "loading"
              ? <Loader2 className="ml-2 h-4 w-4 shrink-0 animate-spin opacity-50" aria-hidden />
              : <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden />}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="z-[1100] w-[--radix-popover-trigger-width] min-w-[14rem] p-0" align="start">
          <Command filter={matchName}>
            <CommandInput placeholder="Search carriers…" className="h-9" />
            <CommandList className="max-h-60">
              <CommandEmpty>No matching carrier.</CommandEmpty>
              {allowClear && value && (
                <CommandGroup>
                  <CommandItem value="no-carrier" keywords={["No carrier"]} disabled={disabled} onSelect={() => select("")}>
                    <span className="ml-6 text-muted-foreground">No carrier</span>
                  </CommandItem>
                </CommandGroup>
              )}
              {saved && (
                <CommandGroup heading="Saved on this client">
                  <CommandItem value="saved-carrier" keywords={[saved.value]} disabled={disabled} onSelect={() => select(saved.value)}>
                    <Check className={cn("mr-2 h-4 w-4", value === saved.value ? "opacity-100" : "opacity-0")} aria-hidden />
                    <span className="whitespace-pre">{saved.value}</span>
                    {saved.notInSettings && <span className="ml-2 text-xs text-muted-foreground">not in Settings</span>}
                  </CommandItem>
                </CommandGroup>
              )}
              {configured.length > 0 && (
                <CommandGroup heading={saved ? "Settings → Carriers" : undefined}>
                  {configured.map((name, index) => (
                    <CommandItem key={name} value={`carrier-${index}`} keywords={[name]} disabled={disabled} onSelect={() => select(name)}>
                      <Check className={cn("mr-2 h-4 w-4", value === name ? "opacity-100" : "opacity-0")} aria-hidden />
                      {name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {flagged && <p id={`${id}-saved`} className="text-xs text-muted-foreground">(not in Settings) Kept as saved until you choose another carrier.</p>}
      {list.status === "ready" && configured.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No carriers are set up yet. Add them in{" "}
          <a href="/settings?section=carriers" target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline-offset-2 hover:underline">
            Settings → Carriers</a>, then{" "}
          <button type="button" onClick={list.retry} disabled={disabled} className="font-medium text-primary underline-offset-2 hover:underline disabled:opacity-50">refresh</button>.
        </p>
      )}
      {list.status === "error" && (
        <p className="flex items-center gap-2 text-xs text-destructive" aria-live="polite">
          Couldn't load carriers.
          <button type="button" onClick={list.retry} disabled={disabled} className="font-medium underline-offset-2 hover:underline disabled:opacity-50">Retry</button>
        </p>
      )}
    </div>
  );
}
