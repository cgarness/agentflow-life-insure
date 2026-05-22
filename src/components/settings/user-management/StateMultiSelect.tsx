import React, { useMemo, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { US_STATES, US_STATE_NAMES } from "./userManagementUtils";
import type { LicensedStateEntry } from "./userManagementTypes";

interface Props {
  selected: LicensedStateEntry[];
  onChange: (v: LicensedStateEntry[]) => void;
  disabled?: boolean;
}

const StateMultiSelect: React.FC<Props> = ({ selected, onChange, disabled }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selectedStateNames = useMemo(() => selected.map(s => s.state), [selected]);

  const filtered = useMemo(() =>
    search
      ? US_STATES.filter(s =>
          s.toLowerCase().includes(search.toLowerCase()) ||
          (US_STATE_NAMES[s] || "").toLowerCase().includes(search.toLowerCase())
        )
      : US_STATES
  , [search]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {selected.map(s => (
          <div key={s.state} className="flex flex-col gap-1.5 p-2 border rounded-md bg-accent/20 min-w-0">
            <div className="flex items-center justify-between">
              <Badge variant="secondary" className="text-xs">{s.state}</Badge>
              {!disabled && (
                <button
                  type="button"
                  className="rounded-full hover:bg-muted-foreground/20 p-0.5"
                  onClick={() => onChange(selected.filter(x => x.state !== s.state))}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            <Input
              placeholder="License #"
              value={s.licenseNumber}
              disabled={disabled}
              onChange={e => onChange(selected.map(x => x.state === s.state ? { ...x, licenseNumber: e.target.value } : x))}
              className="h-7 text-[10px] px-2"
            />
          </div>
        ))}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-between h-10" disabled={disabled}>
            <span className="text-muted-foreground text-sm">
              {selected.length === 0 ? "Add licensed states..." : `Add more states (${selected.length} selected)`}
            </span>
            <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 ml-2" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <div className="p-2 border-b">
            <Input
              placeholder="Search states..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8"
              autoFocus
            />
          </div>
          <div className="max-h-[300px] overflow-y-auto p-1">
            {filtered.map(st => (
              <label key={st} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent cursor-pointer text-sm">
                <Checkbox
                  checked={selectedStateNames.includes(st)}
                  onCheckedChange={(checked) => {
                    if (checked) onChange([...selected, { state: st, licenseNumber: "" }]);
                    else onChange(selected.filter(s => s.state !== st));
                  }}
                />
                <span className="font-medium">{st}</span>
                <span className="text-muted-foreground text-xs">{US_STATE_NAMES[st]}</span>
              </label>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default StateMultiSelect;
