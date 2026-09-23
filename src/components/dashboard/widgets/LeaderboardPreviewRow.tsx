import React from "react";
import { motion } from "framer-motion";
import LeaderboardAgentAvatar from "@/components/leaderboard/LeaderboardAgentAvatar";
import { displayNameFor, initialsFor } from "@/lib/profile/profile-org-view";
import { cn } from "@/lib/utils";

interface LeaderboardPreviewRowProps {
  index: number;
  rank: number;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  organizationName?: string | null;
  isCurrentUser: boolean;
}

// One row of the Dashboard standings preview: rank, photo, name. Presentational
// only — ranking is decided by the widget from the canonical RPC rows, and no
// score is ever rendered here.
const LeaderboardPreviewRow: React.FC<LeaderboardPreviewRowProps> = ({
  index,
  rank,
  firstName,
  lastName,
  avatarUrl,
  organizationName,
  isCurrentUser,
}) => {
  // The group RPC rows are untyped; never let a missing name throw.
  const person = { firstName: firstName ?? "", lastName: lastName ?? "" };
  const name = displayNameFor(person);

  return (
    <motion.li
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className={cn(
        "flex items-center gap-3 rounded-xl border px-3 py-2",
        isCurrentUser ? "bg-primary/5 border-primary/20" : "bg-muted/30 border-transparent",
      )}
    >
      <span className="w-7 shrink-0 text-sm font-bold tabular-nums text-muted-foreground">{`#${rank}`}</span>
      <LeaderboardAgentAvatar
        avatarUrl={avatarUrl}
        initials={initialsFor(person)}
        alt={name}
        className="h-10 w-10"
        fallbackClassName="text-xs"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-foreground">{name}</p>
        {organizationName && (
          <p className="truncate text-[10px] text-muted-foreground">{organizationName}</p>
        )}
      </div>
      {isCurrentUser && (
        <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-foreground/70">You</span>
      )}
    </motion.li>
  );
};

export default LeaderboardPreviewRow;
