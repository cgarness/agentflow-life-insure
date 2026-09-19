/**
 * profile-milestones — round-number targets, presented as PROGRESS and never as an awarded badge.
 *
 * The page this replaces rendered a "Top Producer" badge at `totalClients >= 10` and a "Hot Streak"
 * badge at `monthWins >= 3` (src/pages/AgentProfile.tsx:136-146). No agency defined either
 * threshold, so both were fabricated accomplishments. They are deleted.
 *
 * What survives is deliberately weaker and honest: a ladder of round numbers, showing where the
 * agent or team currently stands relative to the next one. The thresholds themselves make no claim
 * about industry norms or agency expectations — they exist only to give the current total a scale.
 *
 * NO MILESTONE CARRIES AN ACHIEVED DATE. Dating "your 100th policy" would require every counted
 * policy to carry a sale date, and `clients.sold_date` is NULL for every CSV-imported client and
 * every conversion before the Sold Date build (migration 20260812042319, explicit no-backfill
 * decision). A date computed over an incomplete set would be wrong in a way nobody could see.
 */

export interface ProfileMilestone {
  label: string;
  current: number;
  target: number;
  /** Formatter for both numbers, so currency and counts render consistently. */
  format: (value: number) => string;
}

export interface MilestoneInput {
  totalClients: number;
  totalPolicies: number;
  totalPremiumMonthly: number;
  distinctLicensedStates: number;
  isTeam: boolean;
}

/** The next unreached target, or the highest one once every target is passed. */
function nextTarget(value: number, targets: number[]): number {
  return targets.find((t) => value < t) ?? targets[targets.length - 1];
}

export function buildProfileMilestones(
  input: MilestoneInput,
  formatCount: (n: number) => string,
): ProfileMilestone[] {
  const { isTeam } = input;

  // A team ladder starts higher than an individual one simply because it aggregates many books.
  const clientTargets = isTeam ? [100, 500, 1_000] : [10, 100, 500];
  const policyTargets = isTeam ? [100, 500, 1_000] : [10, 100, 500];
  const premiumTargets = isTeam ? [10_000, 50_000, 100_000] : [1_000, 5_000, 10_000];
  const stateTargets = [2, 5, 10, 25];

  const premium = Math.round(input.totalPremiumMonthly);

  return [
    {
      label: isTeam ? "Team clients" : "Clients",
      current: input.totalClients,
      target: nextTarget(input.totalClients, clientTargets),
      format: formatCount,
    },
    {
      label: isTeam ? "Team policies" : "Policies",
      current: input.totalPolicies,
      target: nextTarget(input.totalPolicies, policyTargets),
      format: formatCount,
    },
    {
      label: "Monthly premium",
      current: premium,
      target: nextTarget(premium, premiumTargets),
      format: (n) => `$${n.toLocaleString("en-US")}`,
    },
    {
      label: isTeam ? "States covered" : "Licensed states",
      current: input.distinctLicensedStates,
      target: nextTarget(input.distinctLicensedStates, stateTargets),
      format: formatCount,
    },
  ];
}
