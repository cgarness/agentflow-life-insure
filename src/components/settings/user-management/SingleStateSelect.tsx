import React, { useMemo, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { US_STATES, US_STATE_NAMES } from "./userManagementUtils";

interface Props {
  value?: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}

const SingleStateSelect: React.FC<Props> = ({ value, onChange, disabled }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const filtered = useMemo(() =>
    search
      ? US_STATES.filter(s =>
          s.toLowerCase().includes(search.toLowerCase()) ||
          (US_STATE_NAMES[s] || "").toLowerCase().includes(search.toLowerCase())
        )
      : US_STATES
  , [search]);

  return (
    <div>
      {value && (
        <div className="flex flex-wrap gap-1 mb-2">
          <Badge variant="secondary" className="text-xs gap-1 pr-1">
            {value} - {US_STATE_NAMES[value]}
            {!disabled && (
              <button
                type="button"
                className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                onClick={() => onChange("")}
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </Badge>
        </div>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-between h-10" disabled={disabled}>
            <span className="text-muted-foreground text-sm">
              {value ? `${value} - ${US_STATE_NAMES[value]}` : "Select resident state..."}
            </span>
            <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 ml-2" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <div className="p-2 border-b">
            <Input placeholder="Search states..." value={search} onChange={e => setSearch(e.target.value)} className="h-8" autoFocus />
          </div>
          <div className="max-h-[300px] overflow-y-auto p-1">
            {filtered.map(st => (
              <button
                key={st}
                type="button"
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent cursor-pointer text-sm text-left ${value === st ? "bg-accent" : ""}`}
                onClick={() => { onChange(st); setOpen(false); setSearch(""); }}
              >
                <span className="font-medium">{st}</span>
                <span className="text-muted-foreground text-xs">{US_STATE_NAMES[st]}</span>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default SingleStateSelect;
