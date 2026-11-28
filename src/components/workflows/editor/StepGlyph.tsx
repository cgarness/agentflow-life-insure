import { cn } from "@/lib/utils";
import type { BlockVisual } from "../steps/blockMeta";

/** Small category icon shared by canvas cards, list rows and picker choices. Decorative: the title names the step. */
export default function StepGlyph({visual, className}: {visual: BlockVisual; className?: string}) {
  const Icon = visual.icon;
  return <span aria-hidden className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-md", visual.chip, className)}>
    <Icon className="h-4 w-4"/>
  </span>;
}
