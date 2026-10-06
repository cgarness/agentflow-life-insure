import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { normalizeReportLayout, type ReportLayoutConfig } from "./report-layout-constants";

export interface LayoutOwner { userId: string; orgId: string }

export function getDefaultLayout(): ReportLayoutConfig { return normalizeReportLayout(null); }

async function assertOwner(owner: LayoutOwner): Promise<void> {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) throw new Error("Could not verify your account. Try again.");
  if (!user || user.id !== owner.userId || user.app_metadata.organization_id !== owner.orgId) {
    throw new Error("Your account or organization changed. Reload Reports before changing your layout.");
  }
}

function failure(action: string, error: { code?: string } | null): Error {
  return new Error(error?.code === "23505"
    ? "Your layout changed in another tab. Reload your layout and try again."
    : `Could not ${action} your report layout. Try again.`);
}

/** Reads never migrate or write preferences. An error is distinct from an absent personal row. */
export async function fetchUserLayout(owner: LayoutOwner): Promise<ReportLayoutConfig> {
  await assertOwner(owner);
  const personal = await supabase.from("report_layouts").select("layout")
    .eq("organization_id", owner.orgId).eq("user_id", owner.userId).maybeSingle();
  if (personal.error) throw failure("load", personal.error);
  if (personal.data) return normalizeReportLayout(personal.data.layout);
  const inherited = await supabase.from("report_layouts").select("layout")
    .eq("organization_id", owner.orgId).is("user_id", null).maybeSingle();
  if (inherited.error) throw failure("load", inherited.error);
  return normalizeReportLayout(inherited.data?.layout);
}

/** Explicit personal save; existing partial indexes do not support a column-only REST upsert. */
export async function saveUserLayout(owner: LayoutOwner, layout: ReportLayoutConfig): Promise<ReportLayoutConfig> {
  const snapshot = normalizeReportLayout(layout);
  await assertOwner(owner);
  const existing = await supabase.from("report_layouts").select("id")
    .eq("organization_id", owner.orgId).eq("user_id", owner.userId).maybeSingle();
  if (existing.error) throw failure("save", existing.error);
  // Auth can change while the preceding request is outstanding. Never adopt its new identity.
  await assertOwner(owner);
  const values = { layout: snapshot as unknown as Json, updated_at: new Date().toISOString() };
  const result = existing.data
    ? await supabase.from("report_layouts").update(values).eq("id", existing.data.id)
      .eq("organization_id", owner.orgId).eq("user_id", owner.userId).select("id").single()
    : await supabase.from("report_layouts").insert({ ...values, organization_id: owner.orgId, user_id: owner.userId })
      .select("id").single();
  if (result.error || !result.data) throw failure("save", result.error);
  return snapshot;
}

/** Reset removes only this person's override, then reads the inherited/default layout. */
export async function resetUserLayout(owner: LayoutOwner): Promise<ReportLayoutConfig> {
  await assertOwner(owner);
  const result = await supabase.from("report_layouts").delete()
    .eq("organization_id", owner.orgId).eq("user_id", owner.userId);
  if (result.error) throw failure("reset", result.error);
  return fetchUserLayout(owner);
}
