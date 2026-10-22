import React from "react";
import OdometerValue from "@/components/leaderboard/OdometerValue";
import { type AgentStats, displayedAp, formatPremiumSold } from "@/components/leaderboard/leaderboardTypes";

interface LeaderboardApValueProps {
  agent: Pick<AgentStats, "policiesSold" | "unknownPremiums" | "premiumSold">;
  className?: string;
  tv?: boolean;
}

/**
 * An agent's AP as delivered by the snapshot (already annual; never re-annualized). Every premium unknown reads "—",
 * never $0; a partly unknown subtotal keeps its amount with the existing "*" marker.
 */
const LeaderboardApValue: React.FC<LeaderboardApValueProps> = ({ agent, className, tv }) => {
  const unknown = agent.unknownPremiums ?? 0;
  return (
    <>
      <OdometerValue value={displayedAp(agent)} format={formatPremiumSold} className={className} tv={tv} />
      {unknown > 0 && <span title={`${unknown} policies have unknown premium`}>*</span>}
    </>
  );
};

export default LeaderboardApValue;
