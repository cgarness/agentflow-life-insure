import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { blocks } from "../../../supabase/functions/_shared/automations/graph";
import type { BlockType } from "./lib/draftGraph";

interface Props {
  label: string;
  triggerOnly?: boolean;
  compact?: boolean;
  onPick: (type: BlockType) => void;
}

export default function AutomationBlockPicker({label, triggerOnly, compact, onPick}: Props) {
  const [open, setOpen] = useState(false);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button aria-label={label} title={label} size={compact ? "icon" : "sm"}
      className={compact ? "nodrag nopan h-7 w-7 rounded-full bg-card" : undefined} variant="outline">
      <Plus className="h-4 w-4"/>{!compact && label}
    </Button></PopoverTrigger>
    <PopoverContent align="start" className="grid gap-1 p-2 data-[state=closed]:hidden"
      aria-hidden={open ? undefined : true} aria-label={label}>
      {blocks.filter(entry => triggerOnly ? entry.category === "trigger" : entry.category !== "trigger").map(entry =>
        <Button className="justify-start" key={entry.type} variant="ghost" onClick={() => {
          onPick(entry.type); setOpen(false);
        }}>{entry.label}</Button>)}
    </PopoverContent>
  </Popover>;
}
