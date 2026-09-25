import { supabase } from "@/integrations/supabase/client";
import { assertPageActive } from "@/lib/pageActivity";
import { monthlyPremiumToAnnual } from "@/components/leaderboard/leaderboardTypes";

type WinPremiumRow = {
  agent_id: string | null;
  contact_id: string | null;
  premium_amount?: number | null;
};

/**
 * A failed read throws so the caller's whole load fails — premium must never
 * render as a "$0" that was really an error.
 */
export async function loadClientMonthlyPremiums(
  contactIds: string[],
  signal?: AbortSignal,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (contactIds.length === 0) return map;
  // A follow-on read: never sent from a tab that went hidden or offline meanwhile.
  assertPageActive();

  let query = supabase
    .from("clients")
    .select("id, premium, premium_amount")
    .in("id", contactIds);
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw error;

  for (const row of data || []) {
    const monthly = Number(row.premium ?? row.premium_amount) || 0;
    map.set(row.id, monthly);
  }
  return map;
}

export function annualPremiumForWin(
  win: WinPremiumRow,
  clientMonthlyById: Map<string, number>,
): number {
  const fromWin = Number(win.premium_amount) || 0;
  const fromClient = win.contact_id ? clientMonthlyById.get(win.contact_id) ?? 0 : 0;
  return monthlyPremiumToAnnual(fromWin || fromClient);
}

export function sumAnnualPremiumForAgent(
  wins: WinPremiumRow[],
  agentId: string,
  clientMonthlyById: Map<string, number>,
): number {
  return wins
    .filter((w) => w.agent_id === agentId)
    .reduce((sum, w) => sum + annualPremiumForWin(w, clientMonthlyById), 0);
}

export async function fetchWinsForPremium(
  agentIds: string[],
  range: { start: Date; end: Date },
  organizationId?: string | null,
  signal?: AbortSignal,
): Promise<WinPremiumRow[]> {
  if (agentIds.length === 0) return [];
  // A follow-on read: never sent from a tab that went hidden or offline meanwhile.
  assertPageActive();

  let query = supabase
    .from("wins")
    .select("agent_id, contact_id, premium_amount, created_at")
    .in("agent_id", agentIds)
    .gte("created_at", range.start.toISOString())
    .lte("created_at", range.end.toISOString());

  if (organizationId) {
    query = query.eq("organization_id", organizationId);
  }
  if (signal) query = query.abortSignal(signal);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as WinPremiumRow[];
}

export async function attachPremiumSoldToAgents<
  T extends { id: string; premiumSold: number },
>(
  agents: T[],
  range: { start: Date; end: Date },
  organizationId?: string | null,
  signal?: AbortSignal,
): Promise<void> {
  const agentIds = agents.map((a) => a.id);
  const wins = await fetchWinsForPremium(agentIds, range, organizationId, signal);
  const contactIds = [...new Set(wins.map((w) => w.contact_id).filter(Boolean))] as string[];
  const clientMonthlyById = await loadClientMonthlyPremiums(contactIds, signal);

  for (const agent of agents) {
    agent.premiumSold = sumAnnualPremiumForAgent(wins, agent.id, clientMonthlyById);
  }
}
