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
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { STATE_ABBR_TO_NAME } from "@/utils/stateUtils";

const states = Object.entries(STATE_ABBR_TO_NAME).map(([abbr, name]) => ({
  value: abbr,
  label: `${name} (${abbr})`,
}));

interface StateSelectorProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function StateSelector({ value, onChange, className }: StateSelectorProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between bg-muted border-border h-9 px-3 font-normal text-sm text-foreground hover:bg-muted/80", className)}
        >
          <span className="truncate">
            {value
              ? states.find((state) => state.value === value)?.label
              : "Select state..."}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 z-[300] w-[200px]" align="start">
        <Command>
          <CommandInput placeholder="Search state..." className="h-9" />
          <CommandEmpty>No state found.</CommandEmpty>
          <CommandGroup className="max-h-60 overflow-y-auto">
            {states.map((state) => (
              <CommandItem
                key={state.value}
                value={state.label}
                onSelect={() => {
                  onChange(state.value);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    "mr-2 h-4 w-4",
                    value === state.value ? "opacity-100" : "opacity-0"
                  )}
                />
                {state.label}
              </CommandItem>
            ))}
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
