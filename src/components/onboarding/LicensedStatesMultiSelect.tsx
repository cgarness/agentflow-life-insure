import React, { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  ALL_LICENSED_STATES,
  filterStates,
  summarizeLicensedStates,
  toggleState,
  visibleChips,
} from "@/components/onboarding/licensedStates";
import {
  ONBOARDING_FIELD_CLASS,
  ONBOARDING_FOCUS_RING_CLASS,
  ONBOARDING_POPOVER_CLASS,
} from "@/components/onboarding/onboardingTheme";

interface LicensedStatesMultiSelectProps {
  id: string;
  /** Full US state names — the stored shape, unchanged from the original checkbox list. */
  value: string[];
  onChange: (next: string[]) => void;
  describedBy?: string;
}

/**
 * Searchable multi-select for licensed states, replacing the 50-checkbox scroll box.
 *
 * Built on the repo's existing Popover + Command primitives (no new package).
 * cmdk's own filtering is disabled so the visible list comes from the pure
 * `filterStates` helper, which keeps search behaviour testable without a DOM.
 *
 * Selecting an item toggles it without closing the popover, and the popover is
 * width-matched to its trigger and capped to the viewport so it stays on screen
 * at 320px.
 */
const LicensedStatesMultiSelect: React.FC<LicensedStatesMultiSelectProps> = ({
  id,
  value,
  onChange,
  describedBy,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => filterStates(query), [query]);
  const summary = summarizeLicensedStates(value);
  const { chips, overflow } = visibleChips(value, 4);
  const allSelected = value.length >= ALL_LICENSED_STATES.length;

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-describedby={describedBy}
            className={cn(ONBOARDING_FIELD_CLASS, "justify-between px-3 font-normal hover:bg-slate-900")}
          >
            <span className="truncate">{summary}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-60" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          collisionPadding={12}
          className={cn(
            ONBOARDING_POPOVER_CLASS,
            "w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-0",
          )}
        >
          <Command shouldFilter={false} className="bg-transparent text-slate-100">
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder="Search states…"
              className="text-slate-100 placeholder:text-slate-500"
            />
            <div className="flex items-center justify-between gap-2 border-b border-slate-700/60 px-2 py-1.5">
              <button
                type="button"
                onClick={() => onChange([...ALL_LICENSED_STATES])}
                disabled={allSelected}
                className={cn(
                  "rounded px-2 py-1 text-xs font-medium text-blue-300 transition-colors hover:text-blue-200 disabled:opacity-40",
                  ONBOARDING_FOCUS_RING_CLASS,
                )}
              >
                Select all
              </button>
              <button
                type="button"
                onClick={() => onChange([])}
                disabled={value.length === 0}
                className={cn(
                  "rounded px-2 py-1 text-xs font-medium text-slate-300 transition-colors hover:text-white disabled:opacity-40",
                  ONBOARDING_FOCUS_RING_CLASS,
                )}
              >
                Clear
              </button>
            </div>
            <CommandList className="max-h-56">
              {filtered.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-slate-400">No state found.</p>
              ) : (
                <CommandGroup>
                  {filtered.map((state) => {
                    const selected = value.includes(state);
                    return (
                      <CommandItem
                        key={state}
                        value={state}
                        onSelect={() => onChange(toggleState(value, state))}
                        aria-selected={selected}
                        className="cursor-pointer text-sm text-slate-200 aria-selected:bg-blue-500/15 data-[selected=true]:bg-slate-800 data-[selected=true]:text-white"
                      >
                        <Check
                          aria-hidden="true"
                          className={cn("mr-2 h-4 w-4 text-blue-400", selected ? "opacity-100" : "opacity-0")}
                        />
                        {state}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {chips.length > 0 && (
        // Chips are supplementary: the trigger already states the count, so they
        // stay hidden on narrow mobile rather than add height there.
        <ul className="hidden flex-wrap gap-1.5 sm:flex">
          {chips.map((state) => (
            <li
              key={state}
              className="rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-xs text-blue-200"
            >
              {state}
            </li>
          ))}
          {overflow > 0 && (
            <li className="rounded-md border border-slate-600/60 bg-slate-800/60 px-2 py-0.5 text-xs text-slate-300">
              +{overflow} more
            </li>
          )}
        </ul>
      )}
    </div>
  );
};

export default LicensedStatesMultiSelect;
