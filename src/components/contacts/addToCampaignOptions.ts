import { z } from "zod";
import type { Tables } from "@/integrations/supabase/types";
import { filterCampaignsForManagement, type CampaignManagementRole } from "@/lib/campaign-assignee-scope";

/**
 * Add to Campaign picker model.
 *
 * Scope is decided on the RAW database rows: `filterCampaignsForManagement` reads `user_id`
 * (Personal owner) and `assigned_agent_ids` (Team participants). Mapping to a UI shape first
 * dropped both fields and hid every owned Personal and assigned Team campaign from Agents.
 *
 * This is picker visibility only. `add_leads_to_campaign` stays the authority for every add.
 */

export const ADD_TO_CAMPAIGN_COLUMNS = "id, name, type, status, user_id, assigned_agent_ids, total_leads";

export type AddToCampaignRow = Pick<
  Tables<"campaigns">,
  "id" | "name" | "type" | "status" | "user_id" | "assigned_agent_ids" | "total_leads"
>;

export interface AddToCampaignOption {
  id: string;
  name: string;
  type: string;
  totalLeads: number;
}

/** The modal's existing management inputs, unchanged. Never a dialing rule. */
export function managementRoleFor(role: string | null | undefined, isSuperAdmin: boolean): CampaignManagementRole {
  return {
    isAdmin: role === "Admin",
    isSuperAdmin,
    viewAll: role === "Admin" || role === "Team Leader",
  };
}

/** Active, in-scope campaigns as picker options. Completed or paused rows never attach. */
export function selectAddToCampaignOptions(
  rows: readonly AddToCampaignRow[],
  userId: string,
  role: CampaignManagementRole,
): AddToCampaignOption[] {
  const active = rows.filter((r) => r.status === "Active");
  return filterCampaignsForManagement(active, userId, role).map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    totalLeads: r.total_leads ?? 0,
  }));
}

export const addToCampaignSubmitSchema = z.object({
  campaignId: z.string().min(1, "Please select a campaign"),
  leadIds: z.array(z.string().min(1)).min(1, "No contacts selected"),
});

export interface AttachResult {
  added: number;
  skipped: number;
  alreadyPresent: number;
}

export interface AttachToast {
  kind: "success" | "error" | "info";
  message: string;
  duration: number;
}

/** Leads already in the campaign are reported as such, never as "not eligible". */
export function describeAttachResult(r: AttachResult, campaignName: string): AttachToast {
  const notEligible = Math.max(0, r.skipped - r.alreadyPresent);
  if (r.added === 0 && r.skipped > 0) {
    if (notEligible === 0) {
      const message = r.alreadyPresent === 1
        ? `Already in ${campaignName}`
        : `All ${r.alreadyPresent} leads are already in ${campaignName}`;
      return { kind: "info", message, duration: 4000 };
    }
    if (r.alreadyPresent > 0) {
      return {
        kind: "error",
        message: `No leads were added — ${r.alreadyPresent} already in ${campaignName}, ${notEligible} not eligible.`,
        duration: 5000,
      };
    }
    return { kind: "error", message: `No leads were added — all ${r.skipped} are not eligible for this campaign.`, duration: 5000 };
  }
  if (r.skipped > 0) {
    const parts = [`${r.added} leads added to ${campaignName}`];
    if (r.alreadyPresent > 0) parts.push(`${r.alreadyPresent} already in campaign`);
    if (notEligible > 0) parts.push(`${notEligible} skipped`);
    return { kind: "success", message: parts.join(", "), duration: 4000 };
  }
  return { kind: "success", message: `${r.added} leads added to ${campaignName}`, duration: 3000 };
}

/** A server refusal (42501) reads as a permission message, not raw Postgres text. */
export function attachErrorMessage(err: unknown): string {
  const e = err as { code?: unknown; message?: unknown } | null | undefined;
  if (e?.code === "42501") return "You don't have permission to add leads to this campaign.";
  return `Failed to add contacts: ${typeof e?.message === "string" ? e.message : "Unknown error"}`;
}
