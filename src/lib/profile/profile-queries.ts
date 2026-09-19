/**
 * profile-queries — the data layer behind the Agent Profile and Team Profile tabs.
 *
 * ---------------------------------------------------------------------------------------------
 * THE ONE RULE THIS MODULE EXISTS TO ENFORCE
 * ---------------------------------------------------------------------------------------------
 * A FAILED QUERY IS NEVER A ZERO. The page this replaced did the opposite: its queryFn read
 * `callsRes.data || []` (src/pages/AgentProfile.tsx:120-122), so an RLS denial, a network failure
 * and a genuinely empty book all rendered as a confident "0 clients". Every read below inspects
 * `.error` and THROWS, so the caller can distinguish three states that must never be conflated:
 *
 *     loading      — the request is in flight
 *     valid empty  — the query succeeded and there is nothing (a truthful zero)
 *     failed       — render "unavailable" with a retry, and NO number at all
 *
 * ---------------------------------------------------------------------------------------------
 * WHERE EACH NUMBER COMES FROM
 * ---------------------------------------------------------------------------------------------
 *  * BOOK OF BUSINESS (clients, policies, premium, carriers, mix, achievements) -> the
 *    `get_profile_book_stats` RPC. It is not a performance choice. `clients` RLS
 *    ("Clients Hierarchical Access") routes a Team Leader's downline through `is_ancestor_of`,
 *    which depends on the defective `profiles.hierarchy_path`, and gives a plain Agent no downline
 *    branch at all — so for anyone below Admin the downline's client rows are NEVER RETURNED over
 *    PostgREST, at any volume. A client-side team aggregate is structurally impossible.
 *
 *  * TEAM READINESS + LICENCE COVERAGE -> the `get_profile_team_readiness` RPC, for the same
 *    reason: `agent_state_licenses` RLS returns only their own rows to a plain Agent.
 *
 *  * ROSTER, DOWNLINE PREVIEW, FULL ORG TREE -> ordinary PostgREST reads. `public.profiles` IS
 *    org-wide readable (`profiles_select_org` is TO public with `organization_id = get_user_org_id()`,
 *    and permissive policies combine with OR), so this is exactly the "query-enforced, not
 *    RLS-enforced" scoping AGENT_RULES section 3 describes — which is why it must fail closed here.
 *
 *  * THE AGENT'S OWN LICENCES -> a direct read. An agent can always read their own rows.
 *
 * Both RPCs are absent from the generated Supabase types, so they are called through the
 * established narrow `(supabase as any).rpc(...)` cast, the same way `get_campaign_card_stats`,
 * `get_queue_metrics` and `get_trusted_today_dialer_stats` are.
 */

import { supabase } from "@/integrations/supabase/client";
import { assertNoQueryError, DashboardQueryError } from "@/lib/dashboard-contact-identity";
import { usersSupabaseApi } from "@/lib/supabase-users";
import type { LicenseRow } from "@/components/settings/state-licenses/stateLicenseSchema";

/** One carrier's share of the book. `carrier` is `null` for the "no carrier recorded" bucket. */
export interface CarrierProductionRow {
  carrier: string | null;
  policies: number;
  premiumMonthly: number;
}

/** One policy type's share. `policyType` is `null` when the stored value was blank. */
export interface PolicyTypeRow {
  policyType: string | null;
  policies: number;
  premiumMonthly: number;
}

export interface PolicyExtreme {
  faceAmount?: number | null;
  premiumMonthly?: number | null;
  carrier: string | null;
  policyType: string | null;
  soldDate: string | null;
}

export interface MonthExtreme {
  month: string;
  policies: number;
  premiumMonthly: number;
}

export interface DialDayExtreme {
  day: string;
  dials: number;
  timeZone: string;
}

export interface BookAchievements {
  largestFace: PolicyExtreme | null;
  largestPremium: PolicyExtreme | null;
  bestPremiumMonth: MonthExtreme | null;
  mostPoliciesMonth: MonthExtreme | null;
  mostDialsDay: DialDayExtreme | null;
}

export interface BookStats {
  scopeAgentCount: number;
  totalClients: number;
  clientsWithoutPolicyDetail: number;
  totalPolicies: number;
  additionalPolicyCount: number;
  malformedAdditionalPolicies: number;
  /** MONTHLY dollars. Never annualized. */
  totalPremiumMonthly: number;
  policiesMissingPremium: number;
  undatedPolicies: number;
  distinctCarriers: number;
  distinctLicensedStates: number;
  carrierBreakdown: CarrierProductionRow[];
  carrierOverflowPolicies: number;
  policyTypeMix: PolicyTypeRow[];
  policyTypeOverflowPolicies: number;
  achievements: BookAchievements;
}

export interface TeamReadinessStats {
  scopeAgentCount: number;
  directReports: number;
  /** EXCLUDES self. */
  totalDownline: number;
  maxDepth: number;
  readyCount: number;
  needsNpn: number;
  needsResidentState: number;
  needsResidentLicense: number;
  needsCarrier: number;
  expiredLicenses: number;
  expiringLicenses30d: number;
  /** A NULL expiration is `expirationStatus() === "none"`, not "Active". Reported, never hidden. */
  licensesWithoutExpiration: number;
  agentsWithLicenses: number;
  statesCovered: number;
  topStates: { state: string; agents: number }[];
}

export type ProfileScope = "self" | "team";

function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function mapPolicyExtreme(raw: unknown): PolicyExtreme | null {
  const r = asRecord(raw);
  if (!r) return null;
  return {
    faceAmount: r.face_amount === undefined ? undefined : num(r.face_amount),
    premiumMonthly: r.premium_monthly === undefined ? undefined : num(r.premium_monthly),
    carrier: text(r.carrier),
    policyType: text(r.policy_type),
    soldDate: text(r.sold_date),
  };
}

function mapMonthExtreme(raw: unknown): MonthExtreme | null {
  const r = asRecord(raw);
  if (!r || !text(r.month)) return null;
  return {
    month: String(r.month),
    policies: num(r.policies),
    premiumMonthly: num(r.premium_monthly),
  };
}

function mapDialDay(raw: unknown): DialDayExtreme | null {
  const r = asRecord(raw);
  if (!r || !text(r.day) || !text(r.time_zone)) return null;
  return { day: String(r.day), dials: num(r.dials), timeZone: String(r.time_zone) };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Fetch the lifetime book-of-business aggregate for one scope.
 *
 * `timeZone` is the browser's IANA zone, used ONLY for the Most Dials in a Day achievement, and
 * only for `scope === "self"`. It is validated SERVER-SIDE against `pg_timezone_names`: an unknown
 * value raises rather than silently bucketing in UTC. `profiles.timezone` is deliberately not used
 * — it stores Rails/ActiveSupport labels ("Eastern Time (US & Canada)") that are not IANA names.
 */
export async function fetchProfileBookStats(
  scope: ProfileScope,
  timeZone: string | null,
): Promise<BookStats> {
  const result = await (supabase as any).rpc("get_profile_book_stats", {
    p_scope: scope,
    p_time_zone: scope === "self" ? timeZone : null,
  });

  assertNoQueryError(`profile-book-stats:${scope}`, result);

  const row = Array.isArray(result?.data) ? result.data[0] : result?.data;
  if (!row) {
    // The function is defined to return exactly one row. No row means something is wrong with the
    // call, and reporting that as an empty book would be the exact lie this module exists to stop.
    throw new DashboardQueryError(
      `profile-book-stats:${scope}`,
      new Error("get_profile_book_stats returned no row"),
    );
  }

  const achievements = asRecord(row.achievements) ?? {};

  return {
    scopeAgentCount: num(row.scope_agent_count),
    totalClients: num(row.total_clients),
    clientsWithoutPolicyDetail: num(row.clients_without_policy_detail),
    totalPolicies: num(row.total_policies),
    additionalPolicyCount: num(row.additional_policy_count),
    malformedAdditionalPolicies: num(row.malformed_additional_policies),
    totalPremiumMonthly: num(row.total_premium_monthly),
    policiesMissingPremium: num(row.policies_missing_premium),
    undatedPolicies: num(row.undated_policies),
    distinctCarriers: num(row.distinct_carriers),
    distinctLicensedStates: num(row.distinct_licensed_states),
    carrierBreakdown: asArray(row.carrier_breakdown).map((e) => {
      const r = asRecord(e) ?? {};
      return {
        carrier: text(r.carrier),
        policies: num(r.policies),
        premiumMonthly: num(r.premium_monthly),
      };
    }),
    carrierOverflowPolicies: num(row.carrier_overflow_policies),
    policyTypeMix: asArray(row.policy_type_mix).map((e) => {
      const r = asRecord(e) ?? {};
      return {
        policyType: text(r.policy_type),
        policies: num(r.policies),
        premiumMonthly: num(r.premium_monthly),
      };
    }),
    policyTypeOverflowPolicies: num(row.policy_type_overflow_policies),
    achievements: {
      largestFace: mapPolicyExtreme(achievements.largest_face),
      largestPremium: mapPolicyExtreme(achievements.largest_premium),
      bestPremiumMonth: mapMonthExtreme(achievements.best_premium_month),
      mostPoliciesMonth: mapMonthExtreme(achievements.most_policies_month),
      mostDialsDay: mapDialDay(achievements.most_dials_day),
    },
  };
}

/** Fetch the team readiness + licence-coverage aggregate. Counts only; no per-agent row. */
export async function fetchTeamReadiness(): Promise<TeamReadinessStats> {
  const result = await (supabase as any).rpc("get_profile_team_readiness", {});

  assertNoQueryError("profile-team-readiness", result);

  const row = Array.isArray(result?.data) ? result.data[0] : result?.data;
  if (!row) {
    throw new DashboardQueryError(
      "profile-team-readiness",
      new Error("get_profile_team_readiness returned no row"),
    );
  }

  return {
    scopeAgentCount: num(row.scope_agent_count),
    directReports: num(row.direct_reports),
    totalDownline: num(row.total_downline),
    maxDepth: num(row.max_depth),
    readyCount: num(row.ready_count),
    needsNpn: num(row.needs_npn),
    needsResidentState: num(row.needs_resident_state),
    needsResidentLicense: num(row.needs_resident_license),
    needsCarrier: num(row.needs_carrier),
    expiredLicenses: num(row.expired_licenses),
    expiringLicenses30d: num(row.expiring_licenses_30d),
    licensesWithoutExpiration: num(row.licenses_without_expiration),
    agentsWithLicenses: num(row.agents_with_licenses),
    statesCovered: num(row.states_covered),
    topStates: asArray(row.top_states).map((e) => {
      const r = asRecord(e) ?? {};
      return { state: String(r.state ?? ""), agents: num(r.agents) };
    }),
  };
}

/** The signed-in agent's own state licences. Always organization- AND agent-scoped. */
export async function fetchOwnLicenses(
  agentId: string,
  organizationId: string,
): Promise<LicenseRow[]> {
  const result = await supabase
    .from("agent_state_licenses")
    .select("id, agent_id, state, license_number, expiration_date, created_at")
    .eq("organization_id", organizationId)
    .eq("agent_id", agentId)
    .order("state");

  assertNoQueryError("profile-own-licenses", result);
  return (result.data ?? []) as unknown as LicenseRow[];
}

/** A downline profile as the preview and the org tree need it. */
export interface DownlineProfile {
  id: string;
  first_name: string;
  last_name: string;
  role: string;
  status: string;
  upline_id: string | null;
}

export interface TeamRoster {
  profiles: DownlineProfile[];
  /** The viewer's own id, which is the root of the tree and is excluded from "Total Downline". */
  rootId: string;
}

/**
 * Resolve the viewer's authorized scope and load those profiles.
 *
 * `getAgentScopeIds` is the ONE downline resolver: a BFS over `profiles.upline_id`,
 * organization-constrained on every round, cycle-safe, paged to exhaustion, and it THROWS on any
 * Supabase error rather than returning a partial or org-wide set. `hierarchy_path` is never read —
 * it is defective in production and `is_ancestor_of` therefore denies almost everything.
 *
 * `avatar_url` is DELIBERATELY NOT SELECTED. It holds a base64 data URL
 * (`ProfileAvatarUploader.tsx:48`), so selecting it across a downline would pull megabytes into the
 * browser to render a 32px circle. The roster renders initials.
 *
 * An org-wide viewer (Admin / non-impersonating Super Admin) still gets a roster resolved from
 * `upline_id`, because the downline PREVIEW and TREE are about the structure beneath the viewer.
 * Their org-wide business figures come from the RPC, which applies the agency-wide contract.
 */
export async function fetchTeamRoster(
  viewerId: string,
  organizationId: string,
): Promise<TeamRoster> {
  const scopeIds = await usersSupabaseApi.getAgentScopeIds({ viewerId, organizationId });

  if (scopeIds.length === 0) {
    // getAgentScopeIds seeds its set with the viewer, so an empty array can only mean a missing
    // viewerId/organizationId. Failing closed here beats rendering an empty organization.
    throw new DashboardQueryError(
      "profile-team-roster",
      new Error("Agent scope resolved to an empty set"),
    );
  }

  const result = await supabase
    .from("profiles")
    .select("id, first_name, last_name, role, status, upline_id")
    .eq("organization_id", organizationId)
    .in("id", scopeIds)
    .order("first_name", { ascending: true });

  assertNoQueryError("profile-team-roster", result);

  return {
    profiles: (result.data ?? []) as unknown as DownlineProfile[],
    rootId: viewerId,
  };
}
