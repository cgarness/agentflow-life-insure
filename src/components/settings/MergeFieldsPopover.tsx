import { useState } from "react";
import { Braces } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MERGE_FIELD_GROUPS } from "@/components/settings/templateMergeData";

interface MergeFieldsPopoverProps {
  onInsert: (token: string) => void;
}

export function MergeFieldsPopover({ onInsert }: MergeFieldsPopoverProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1.5 text-xs">
          <Braces className="h-3.5 w-3.5 shrink-0" />
          Merge Fields
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="max-h-[280px] overflow-y-auto p-2">
          {MERGE_FIELD_GROUPS.map((group) => (
            <div key={group.title} className="mb-3 last:mb-0">
              <p className="px-2 pb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {group.title}
              </p>
              <div className="space-y-0.5">
                {group.rows.map((row) => (
                  <button
                    key={row.token}
                    type="button"
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent"
                    onClick={() => {
                      onInsert(row.token);
                      setOpen(false);
                    }}
                  >
                    <span className="font-mono text-xs text-primary">{row.token}</span>
                    <span className="text-xs text-muted-foreground">{row.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
