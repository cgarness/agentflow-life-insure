import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { DATA_BASIS_DESCRIPTION, DATA_BASIS_TITLE } from "@/lib/reports-basis-text";
import { cn } from "@/lib/utils";
import DataBasisSections, { type DataBasisContent } from "./DataBasisSections";

export interface DataBasisButtonProps extends DataBasisContent {
  className?: string;
}

const SHEET_SIDE = {
  bottom: "max-h-[85dvh] overflow-y-auto overscroll-contain rounded-t-xl pb-[max(1rem,env(safe-area-inset-bottom))]",
  right: "w-full overflow-y-auto sm:max-w-md",
} as const;

/**
 * "Data basis" disclosure. Each instance owns its own Sheet and SheetTrigger, so closing (Esc or Close)
 * returns focus to the trigger that opened it. A bottom sheet below 768px, a right sheet from 768px.
 * The trigger is 20px tall visually with a 40px hit area; the content mounts only while open.
 */
export function DataBasisButton({ className, ...content }: DataBasisButtonProps) {
  const side = useIsMobile() ? "bottom" : "right";
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button type="button" variant="ghost" size="sm"
          className={cn("relative h-5 gap-1 rounded-sm px-1 text-xs font-medium text-foreground underline-offset-4 hover:bg-transparent hover:text-foreground hover:underline [&_svg]:size-3.5 after:absolute after:inset-x-0 after:-inset-y-2.5", className)}>
          <Info className="text-muted-foreground" aria-hidden="true" />
          {DATA_BASIS_TITLE}
        </Button>
      </SheetTrigger>
      <SheetContent side={side} className={SHEET_SIDE[side]}>
        <SheetHeader className="pr-6 text-left">
          <SheetTitle>{DATA_BASIS_TITLE}</SheetTitle>
          <SheetDescription>{DATA_BASIS_DESCRIPTION}</SheetDescription>
        </SheetHeader>
        <DataBasisSections {...content} />
      </SheetContent>
    </Sheet>
  );
}

export default DataBasisButton;
