import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useMinWidth } from "@/hooks/useMinWidth";
import { cn } from "@/lib/utils";
import type { AutomationGraph } from "../../../supabase/functions/_shared/automations/graph";
import type { BlockType } from "./lib/draftGraph";
import BlockChoices from "./picker/BlockChoices";

interface Props {
  /** Visible text of the opener and the accessible name of both the opener and the picker. */
  label: string;
  /** The draft the step will join. Only choices valid at this point are offered. */
  graph: AutomationGraph;
  /** Round icon button for the canvas. */
  compact?: boolean;
  /** Filled button, for the one obvious next action on an empty workflow. */
  primary?: boolean;
  onPick: (type: BlockType) => void;
}

export default function AutomationBlockPicker({label, graph, compact, primary, onPick}: Props) {
  const [open, setOpen] = useState(false);
  const desktop = useMinWidth(768);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button type="button" aria-label={label} title={compact ? label : undefined} size={compact ? "icon" : "sm"}
        variant={primary ? "default" : "outline"}
        className={cn(compact ? "nodrag nopan h-8 w-8 rounded-full" : "h-11 md:h-9", compact && !primary && "bg-card")}>
        <Plus aria-hidden/>{!compact && label}
      </Button>
    </PopoverTrigger>
    {/* Closed content is removed from layout at once, so only one picker is ever exposed. */}
    <PopoverContent align="start" collisionPadding={12} aria-label={label} aria-hidden={open ? undefined : true}
      className="flex max-h-[min(26rem,var(--radix-popover-content-available-height))] w-80 max-w-[calc(100vw-1.5rem)] flex-col p-0 data-[state=closed]:hidden"
      // On a phone the search box is not focused on open, so the keyboard does not cover the choices.
      onOpenAutoFocus={desktop ? undefined : event => { event.preventDefault(); (event.currentTarget as HTMLElement | null)?.focus(); }}>
      <BlockChoices graph={graph} onPick={type => { setOpen(false); onPick(type); }}/>
    </PopoverContent>
  </Popover>;
}
