import { badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Names a condition's path in words, so the branch never depends on colour or position. */
export default function BranchTag({branch}: {branch: "yes" | "no"}) {
  return <span className={cn(badgeVariants({variant: branch === "yes" ? "success" : "neutral"}), "border-border")}>
    {branch === "yes" ? "Yes" : "No"}
  </span>;
}
