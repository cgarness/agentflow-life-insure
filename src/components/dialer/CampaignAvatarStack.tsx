import React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { initialsFor, type AssigneeProfile } from "./campaignSelectionModel";

interface CampaignAvatarStackProps {
  people: AssigneeProfile[];
  /** Collapsed-row stacks stay compact; overflow renders as "+N". */
  max?: number;
  className?: string;
}

/**
 * Compact overlapping avatar stack for the leadership Assigned cell.
 * Names surface via title text; unknown profiles fall back to "?" initials.
 */
export default function CampaignAvatarStack({ people, max = 4, className }: CampaignAvatarStackProps) {
  if (people.length === 0) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  const shown = people.slice(0, max);
  const overflow = people.length - shown.length;

  return (
    <div className={cn("flex items-center", className)}>
      <div className="flex -space-x-2">
        {shown.map((p) => (
          <Avatar
            key={p.id}
            data-testid="avatar-stack-item"
            title={p.displayName ?? "Unknown"}
            className="h-6 w-6 ring-2 ring-background"
          >
            {p.avatarUrl ? <AvatarImage src={p.avatarUrl} alt={p.displayName ?? "Unknown"} /> : null}
            <AvatarFallback className="bg-primary/10 text-primary text-[9px] font-bold">
              {initialsFor(p.displayName)}
            </AvatarFallback>
          </Avatar>
        ))}
      </div>
      {overflow > 0 && (
        <span className="ml-1.5 text-xs font-semibold text-muted-foreground">+{overflow}</span>
      )}
    </div>
  );
}
