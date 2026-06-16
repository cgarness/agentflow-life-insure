import { startOfDay, startOfWeek, startOfMonth, subDays, subWeeks, subMonths } from "date-fns";

export type Period = "Today" | "This Week" | "This Month";
export type Metric =
  | "Policies Sold"
  | "Calls Made"
  | "Appointments Set"
  | "Talk Time"
  | "Conversion Rate"
  | "Premium Sold";

export const LEADERBOARD_METRICS: Metric[] = [
  "Policies Sold",
  "Calls Made",
  "Appointments Set",
  "Talk Time",
  "Conversion Rate",
  "Premium Sold",
];

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
  conversionRate: number;
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
  /** Annual premium sold for this win (monthly × 12, with client fallback). */
  premiumSold?: number;
  created_at: string;
}

export const metricKey = (m: Metric): keyof AgentStats => {
  switch (m) {
    case "Policies Sold":
      return "policiesSold";
    case "Calls Made":
      return "callsMade";
    case "Appointments Set":
      return "appointmentsSet";
    case "Talk Time":
      return "talkTime";
    case "Conversion Rate":
      return "conversionRate";
    case "Premium Sold":
      return "premiumSold";
  }
};

export const monthlyPremiumToAnnual = (monthly: number): number =>
  monthly * ANNUAL_PREMIUM_MULTIPLIER;

export const formatPremiumSold = (annualPremium: number): string =>
  `$${Math.round(annualPremium).toLocaleString()}`;

export const metricLabel = (m: Metric): string => {
  switch (m) {
    case "Policies Sold":
      return "policies sold";
    case "Calls Made":
      return "calls made";
    case "Appointments Set":
      return "appointments set";
    case "Talk Time":
      return "talk time";
    case "Conversion Rate":
      return "conversion rate";
    case "Premium Sold":
      return "premium sold";
  }
};

export const formatMetricValue = (m: Metric, val: number): string => {
  if (m === "Talk Time") return `${(val / 3600).toFixed(1)} hrs`;
  if (m === "Conversion Rate") return `${val.toFixed(1)}%`;
  if (m === "Premium Sold") return formatPremiumSold(val);
  return String(Math.round(val));
};

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

/** Deterministic sort: metric desc, then name, then id. */
export function compareAgentsByMetric(a: AgentStats, b: AgentStats, metric: Metric): number {
  const key = metricKey(metric);
  const diff = (b[key] as number) - (a[key] as number);
  if (diff !== 0) return diff;
  const nameA = `${a.last_name} ${a.first_name}`.toLowerCase();
  const nameB = `${b.last_name} ${b.first_name}`.toLowerCase();
  if (nameA !== nameB) return nameA.localeCompare(nameB);
  return a.id.localeCompare(b.id);
}

export function rankAgents(agents: AgentStats[], metric: Metric): AgentStats[] {
  agents.sort((a, b) => compareAgentsByMetric(a, b, metric));
  agents.forEach((a, i) => {
    a.rank = i + 1;
  });
  return agents;
}

/** True when at least one agent has activity and scores are not all tied. */
export function hasMeaningfulStandings(agents: AgentStats[], metric: Metric): boolean {
  if (agents.length === 0) return false;
  const key = metricKey(metric);
  const values = agents.map((a) => a[key] as number);
  const max = Math.max(...values);
  const min = Math.min(...values);
  return max > 0 && max !== min;
}

export function metricValueMapsEqual(
  agents: AgentStats[],
  prev: Map<string, number>,
  metric: Metric,
): boolean {
  if (prev.size !== agents.length) return false;
  const key = metricKey(metric);
  for (const a of agents) {
    if (prev.get(a.id) !== (a[key] as number)) return false;
  }
  return true;
}

export function snapshotMetricValues(agents: AgentStats[], metric: Metric): Map<string, number> {
  const key = metricKey(metric);
  const map = new Map<string, number>();
  for (const a of agents) {
    map.set(a.id, a[key] as number);
  }
  return map;
}
