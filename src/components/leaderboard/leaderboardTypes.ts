import { startOfDay, startOfWeek, startOfMonth, subDays, subWeeks, subMonths } from "date-fns";
import { isPremiumWhollyUnknown } from "@/lib/premiumAvailability";

export type Period = "Today" | "This Week" | "This Month";
/** Annualized Premium is the Leaderboard's only ranking metric (page, TV and the Dashboard preview). */
export const AP_LABEL = "AP";
export const AP_FULL_LABEL = "Annualized Premium";

export const ANNUAL_PREMIUM_MULTIPLIER = 12;
export type LeaderboardView = "org" | "group";

/** Live rank change since the previous displayed leaderboard snapshot (not calendar-period trend). */
export type RankMovement = {
  direction: "up" | "down";
  spots: number;
};

export interface AgentStats {
  id: string;
  first_name: string;
  last_name: string;
  avatar_url?: string;
  callsMade: number;
  policiesSold: number;
  appointmentsSet: number;
  talkTime: number;
  conversionRate: number | null;
  unknownPremiums?: number;
  estimatedDurationCalls?: number;
  unknownDurationCalls?: number;
  conflictingDurationCalls?: number;
  premiumSold: number;
  recentWins7d: number;
  rank: number;
  organizationId?: string | null;
  organizationName?: string | null;
}

export interface Win {
  id: string;
  agent_id?: string | null;
  agent_name: string;
  contact_id?: string | null;
  contact_name: string;
  campaign_name: string;
  policy_type: string;
  premium_amount?: number | null;
  premium_snapshot?: boolean;
  /** Annual premium sold for this win (monthly × 12, with client fallback). */
  premiumSold?: number | null;
  premium_known?: boolean;
  celebrated?: boolean | null;
  created_at: string;
  /** Agency Sold Date (YYYY-MM-DD), the sale's production date; null when the sale has none. */
  sold_date?: string | null;
  /** When the sale was entered (recorded_at, else created_at). Never the time of sale. */
  entered_at?: string;
}

export const monthlyPremiumToAnnual = (monthly: number): number =>
  monthly * ANNUAL_PREMIUM_MULTIPLIER;

export const formatPremiumSold = (annualPremium: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(annualPremium);

export const formatTalkTime = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
  return h ? `${h}h ${m}m ${s}s` : m ? `${m}m ${s}s` : `${s}s`;
};

/**
 * The AP an agent's cell shows: null ("—") when the agent sold policies in the period but every premium is unknown
 * (D14), never a $0 sale. Ranking keeps using the known subtotal.
 */
export const displayedAp = (agent: Pick<AgentStats, "policiesSold" | "unknownPremiums" | "premiumSold">): number | null =>
  isPremiumWhollyUnknown(agent.policiesSold, agent.unknownPremiums) ? null : agent.premiumSold;

export const formatCount = (n: number): string => String(Math.round(n));

export const getPeriodRange = (period: Period): { start: Date; end: Date } => {
  const now = new Date();
  switch (period) {
    case "Today":
      return { start: startOfDay(now), end: now };
    case "This Week":
      return { start: startOfWeek(now, { weekStartsOn: 1 }), end: now };
    case "This Month":
      return { start: startOfMonth(now), end: now };
  }
};

export const getPrevPeriodRange = (period: Period): { start: Date; end: Date } => {
  const now = new Date();
  switch (period) {
    case "Today": {
      const prev = subDays(now, 1);
      return { start: startOfDay(prev), end: prev };
    }
    case "This Week": {
      const prev = subWeeks(now, 1);
      return { start: startOfWeek(prev, { weekStartsOn: 1 }), end: prev };
    }
    case "This Month": {
      const prev = subMonths(now, 1);
      return { start: startOfMonth(prev), end: prev };
    }
  }
};

export const mapPeriodToRpcParam = (p: Period): string => {
  switch (p) {
    case "Today":
      return "today";
    case "This Week":
      return "week";
    case "This Month":
      return "month";
    default:
      return "month";
  }
};

const nameKey = (a: AgentStats) => `${a.last_name} ${a.first_name}`.toLowerCase();

/** Deterministic AP order: AP desc, then Policies desc, Calls desc, last/first name, profile id. */
export function compareAgentsByAp(a: AgentStats, b: AgentStats): number {
  return (
    b.premiumSold - a.premiumSold ||
    b.policiesSold - a.policiesSold ||
    b.callsMade - a.callsMade ||
    nameKey(a).localeCompare(nameKey(b)) ||
    a.id.localeCompare(b.id)
  );
}

/** Sorts in place by AP and assigns unique ranks 1…N. */
export function rankAgents(agents: AgentStats[]): AgentStats[] {
  agents.sort(compareAgentsByAp);
  agents.forEach((a, i) => {
    a.rank = i + 1;
  });
  return agents;
}

/**
 * Every value the order depends on (AP, Policies, Calls). A reorder decided by a tie-break is a real rank change, so
 * change detection compares the whole sort key, never AP alone.
 */
const rankingFingerprint = (a: AgentStats): string => `${a.premiumSold}|${a.policiesSold}|${a.callsMade}`;

/**
 * True when agents differ on any part of the sort key. Otherwise (an empty or all-identical board) the order is
 * alphabetical and cannot move. All-$0 AP with differing Calls is meaningful: the Calls tie-break orders it.
 */
export function hasMeaningfulStandings(agents: AgentStats[]): boolean {
  if (agents.length === 0) return false;
  const first = rankingFingerprint(agents[0]);
  return agents.some((a) => rankingFingerprint(a) !== first);
}

export function snapshotRankingValues(agents: AgentStats[]): Map<string, string> {
  return new Map(agents.map((a) => [a.id, rankingFingerprint(a)]));
}

export function rankingValuesEqual(agents: AgentStats[], prev: Map<string, string>): boolean {
  return prev.size === agents.length && agents.every((a) => prev.get(a.id) === rankingFingerprint(a));
}
