/**
 * AchievementTiles — the record tiles and the milestone ladder, split out of AchievementsCard so
 * each file stays under the component size rule and the rendering stays trivially testable.
 *
 * Nothing here decides WHETHER a record exists: it renders only the records it is handed, and the
 * card omits any the aggregate could not compute. An unearned record is absent, never zero.
 */

import React from "react";
import {
  ShareBar,
} from "./ProfilePrimitives";
import {
  formatCount,
} from "@/lib/profile/profile-format";
import type { ProfileMilestone } from "@/lib/profile/profile-milestones";

export const AchievementTile: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  detail?: string | null;
}> = ({ icon, label, value, detail }) => (
  <div className="rounded-xl border border-border/60 bg-card p-4">
    <div className="flex items-center gap-2 text-muted-foreground">
      <span className="text-primary">{icon}</span>
      <p className="text-[11px] font-medium uppercase tracking-wider">{label}</p>
    </div>
    <p className="mt-2 text-xl font-semibold tracking-tight text-foreground tabular-nums">{value}</p>
    {detail && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p>}
  </div>
);

export const MilestoneLadder: React.FC<{ milestones: ProfileMilestone[] }> = ({ milestones }) => {
  if (milestones.length === 0) return null;

  return (
    <div className="mt-6 border-t border-border/60 pt-5">
      <p className="mb-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        Progress to next milestone
      </p>
      <ul className="grid gap-4 sm:grid-cols-2">
        {milestones.map((m) => (
          <li key={m.label}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
              <span className="text-foreground">{m.label}</span>
              <span className="tabular-nums text-muted-foreground">
                <span className="font-medium text-foreground">{m.format(m.current)}</span>
                {" / "}
                {m.format(m.target)}
              </span>
            </div>
            <ShareBar percent={m.target === 0 ? 0 : (m.current / m.target) * 100} />
          </li>
        ))}
      </ul>
    </div>
  );
};

/** Restated on the card because the monthly records are computed over a SUBSET when it is non-zero. */
export const UndatedPolicyNote: React.FC<{ count: number }> = ({ count }) => {
  if (count <= 0) return null;
  return (
    <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
      {formatCount(count)} {count === 1 ? "policy has" : "policies have"} no sale date recorded and{" "}
      {count === 1 ? "is" : "are"} excluded from the monthly records.
    </p>
  );
};
