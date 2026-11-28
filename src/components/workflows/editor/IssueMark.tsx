import { CircleAlert } from "lucide-react";
import { badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Problem marker for a step card. A span, so it may sit inside the card's button. */
export default function IssueMark({count, className}: {count: number; className?: string}) {
  if (count < 1) return null;
  return <span className={cn(badgeVariants({variant: "error"}), "gap-1", className)}>
    <CircleAlert aria-hidden className="h-3 w-3"/>{count === 1 ? "1 issue" : count + " issues"}
  </span>;
}
