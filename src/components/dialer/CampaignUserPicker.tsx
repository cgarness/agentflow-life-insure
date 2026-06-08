import React, { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface PickerProfile {
  id: string;
  name: string;
  email?: string | null;
  role?: string | null;
}

interface CampaignUserPickerProps {
  /** Same-org profiles only — the caller must scope this list. Never other orgs. */
  profiles: PickerProfile[];
  selectedIds: string[];
  onToggle: (userId: string) => void;
  placeholder: string;
  emptyText: string;
  disabled?: boolean;
}

/**
 * Searchable multi-select over same-org teammates (Popover + cmdk). Selecting an
 * item toggles its grant and keeps the menu open; selected chips are rendered by
 * the parent so they can be removed without reopening.
 */
export default function CampaignUserPicker({
  profiles,
  selectedIds,
  onToggle,
  placeholder,
  emptyText,
  disabled = false,
}: CampaignUserPickerProps) {
  const [open, setOpen] = useState(false);
  const selected = new Set(selectedIds);
  const count = selectedIds.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal text-sm"
        >
          <span className="truncate text-muted-foreground">
            {count > 0 ? `${count} selected` : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 z-[300] w-[--radix-popover-trigger-width] min-w-[16rem]" align="start">
        <Command
          filter={(value, search) =>
            value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
          }
        >
          <CommandInput placeholder={placeholder} className="h-9" />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup className="max-h-60 overflow-y-auto">
              {profiles.map((p) => {
                const isSelected = selected.has(p.id);
                return (
                  <CommandItem
                    key={p.id}
                    value={`${p.name} ${p.email ?? ""}`}
                    onSelect={() => onToggle(p.id)}
                  >
                    <Check
                      className={cn("mr-2 h-4 w-4", isSelected ? "opacity-100" : "opacity-0")}
                    />
                    <span className="flex flex-col">
                      <span className="text-sm">{p.name}</span>
                      {p.email && (
                        <span className="text-xs text-muted-foreground">{p.email}</span>
                      )}
                    </span>
                    {p.role && (
                      <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">
                        {p.role}
                      </span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
