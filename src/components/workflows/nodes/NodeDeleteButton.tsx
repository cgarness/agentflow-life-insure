import React, { useState } from "react";
import { X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface Props {
  onConfirm: () => void;
}

const NodeDeleteButton: React.FC<Props> = ({ onConfirm }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="absolute right-2 top-2 z-10 hidden group-hover:block">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Delete step"
            onClick={(e) => { e.stopPropagation(); setOpen(true); }}
            className="flex h-[18px] w-[18px] items-center justify-center rounded-full border border-border/60 bg-card text-muted-foreground transition-colors hover:border-rose-500 hover:bg-rose-500/10 hover:text-rose-500"
          >
            <X className="h-3 w-3" strokeWidth={3} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={6}
          className="w-auto p-3"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="mb-2 text-xs text-foreground">Delete this step?</p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setOpen(false); }}
              className="rounded-md border border-border/50 bg-background px-2 py-1 text-xs text-foreground hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setOpen(false); onConfirm(); }}
              className="rounded-md bg-rose-500 px-2 py-1 text-xs font-medium text-white hover:bg-rose-600"
            >
              Delete
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default NodeDeleteButton;
