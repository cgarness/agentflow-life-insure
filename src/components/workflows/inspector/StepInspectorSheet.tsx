import { useLayoutEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { graphBlock } from "../../../../supabase/functions/_shared/automations/graph";
import StepSettings from "./StepSettings";
import type { StepInspectorSheetProps } from "./types";

/** Step settings on a phone: a bottom sheet over the timeline. Closing it hands focus back to the step that opened it. */
export default function StepInspectorSheet({open, onOpenChange, onClose: _onClose, ...props}: StepInspectorSheetProps) {
  const opener = useRef<HTMLElement | null>(null);
  // Runs before the sheet takes focus, so the active element is still the control that opened it.
  useLayoutEffect(() => {
    const active = document.activeElement;
    if (open && active instanceof HTMLElement && active !== document.body) opener.current = active;
  }, [open]);
  const label = graphBlock(props.node)?.label ?? props.node.type.replace(/_/g, " ");
  return <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent side="bottom"
      className="flex max-h-[85dvh] flex-col gap-0 rounded-t-lg p-0 data-[state=closed]:duration-200 data-[state=open]:duration-200 motion-reduce:transition-none motion-reduce:data-[state=closed]:animate-none motion-reduce:data-[state=open]:animate-none"
      onCloseAutoFocus={event => {
        event.preventDefault();
        if (opener.current?.isConnected) opener.current.focus();
      }}>
      <SheetHeader className="space-y-0 border-b px-4 py-3 pr-12 text-left">
        <SheetTitle>{label}</SheetTitle>
        <SheetDescription className="sr-only">Settings for this step.</SheetDescription>
      </SheetHeader>
      <section aria-label="Configure block" className="min-h-0 flex-1 overflow-y-auto px-4 py-4 text-sm">
        <StepSettings {...props}/>
      </section>
      <SheetFooter className="border-t px-4 py-3">
        <Button type="button" className="h-11 w-full sm:w-auto" onClick={() => onOpenChange(false)}>Done</Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>;
}
