
import { supabase } from "@/integrations/supabase/client";
import { PipelineStage, CustomField, LeadSource } from "@/lib/types";

// ==================== PIPELINE STAGES ====================

function rowToStage(row: any): PipelineStage {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    isDefault: row.is_default,
    convertToClient: row.convert_to_client || false,
    order: row.sort_order,
    pipelineType: row.pipeline_type as "lead" | "recruit",
  };
}

function requireOrganizationId(organizationId: string | null | undefined): string {
  if (!organizationId) {
    throw new Error("Organization context is required for this action.");
  }
  return organizationId;
}

export const pipelineSupabaseApi = {
  async getLeadStages(organizationId: string | null | undefined): Promise<PipelineStage[]> {
    if (!organizationId) return [];
    const { data, error } = await (supabase as any)
      .from("pipeline_stages")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("pipeline_type", "lead")
      .order("sort_order", { ascending: true });
    if (error) throw error;
    return (data || []).map(rowToStage);
  },
  async getRecruitStages(organizationId: string | null | undefined): Promise<PipelineStage[]> {
    if (!organizationId) return [];
    const { data, error } = await (supabase as any)
      .from("pipeline_stages")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("pipeline_type", "recruit")
      .order("sort_order", { ascending: true });
    if (error) throw error;
    return (data || []).map(rowToStage);
  },
  async createStage(data: Omit<PipelineStage, "id">, organizationId: string | null | undefined): Promise<PipelineStage> {
    const orgId = requireOrganizationId(organizationId);
    const { data: result, error } = await (supabase as any)
      .from("pipeline_stages")
      .insert({
        name: data.name,
        color: data.color,
        is_default: data.isDefault,
        convert_to_client: data.convertToClient,
        sort_order: data.order,
        pipeline_type: data.pipelineType,
        organization_id: orgId,
      } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
      .select()
      .single();
    if (error) throw error;
    return rowToStage(result);
  },
  async updateStage(
    id: string,
    pipelineType: string,
    data: Partial<PipelineStage>,
    organizationId: string | null | undefined
  ): Promise<PipelineStage> {
    const orgId = requireOrganizationId(organizationId);
    const payload: any = {};
    if (data.name !== undefined) payload.name = data.name;
    if (data.color !== undefined) payload.color = data.color;
    if (typeof data.isDefault === "boolean") payload.is_default = data.isDefault;
    if (typeof data.convertToClient === "boolean") payload.convert_to_client = data.convertToClient;
    if (data.order !== undefined) payload.sort_order = data.order;

    const { data: result, error } = await (supabase as any)
      .from("pipeline_stages")
      .update(payload)
      .eq("id", id)
      .eq("organization_id", orgId)
      .eq("pipeline_type", pipelineType)
      .select()
      .single();
    if (error) throw error;
    return rowToStage(result);
  },
  async deleteStage(id: string, pipelineType: string, organizationId: string | null | undefined): Promise<void> {
    const orgId = requireOrganizationId(organizationId);
    // RLS DELETE policy blocks deletion of default stages (is_default = true).
    // A blocked delete returns no error from PostgREST but affects 0 rows, so
    // verify the row was actually removed before reporting success.
    const { data, error } = await (supabase as any)
      .from("pipeline_stages")
      .delete()
      .eq("id", id)
      .eq("organization_id", orgId)
      .eq("pipeline_type", pipelineType)
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error("Default stages cannot be deleted.");
    }
  },
  async reorderStages(ids: string[], pipelineType: string, organizationId: string | null | undefined): Promise<void> {
    const orgId = requireOrganizationId(organizationId);
    for (let index = 0; index < ids.length; index++) {
      const id = ids[index];
      const { error } = await (supabase as any)
        .from("pipeline_stages")
        .update({ sort_order: index + 1 })
        .eq("id", id)
        .eq("organization_id", orgId)
        .eq("pipeline_type", pipelineType);
      if (error) throw error;
    }
  },
};

// ==================== CUSTOM FIELDS ====================

function rowToCustomField(row: any): CustomField {
  // Scope derived from ownership columns. See AGENT_RULES.md §5.
  let scope: CustomField["scope"];
  if (row.organization_id == null && row.created_by == null) scope = "system";
  else if (row.organization_id != null && row.created_by == null) scope = "agency";
  else if (row.organization_id != null && row.created_by != null) scope = "personal";
  return {
    id: row.id,
    name: row.name,
    type: row.type as any,
    appliesTo: row.applies_to as any,
    required: row.required,
    active: row.active,
    defaultValue: row.default_value,
    dropdownOptions: row.dropdown_options,
    usageCount: row.usage_count,
    createdBy: row.created_by ?? null,
    scope,
  };
}

function friendlyCustomFieldError(err: any): Error { // eslint-disable-line @typescript-eslint/no-explicit-any
  const msg: string = err?.message ?? "";
  const code: string = err?.code ?? "";
  if (code === "23505" || /already exists|unique_violation/i.test(msg)) {
    return new Error("A custom field with this name already exists.");
  }
  if (code === "42501" || /row-level security|permission/i.test(msg)) {
    return new Error("You don't have permission to modify this custom field.");
  }
  return err instanceof Error ? err : new Error(msg || "Unknown error");
}

export type CreateCustomFieldOptions = {
  /** Admin / Super Admin only: agency-wide field (created_by NULL). RLS enforces. */
  orgWide?: boolean;
};

export const customFieldsSupabaseApi = {
  /**
   * Returns org-owned custom fields visible to the current user. System
   * templates (organization_id IS NULL) are intentionally excluded from the
   * normal CRUD list; they remain readable via RLS for a future template UI.
   */
  async getAll(organizationId: string | null | undefined): Promise<CustomField[]> {
    if (!organizationId) return [];
    const { data, error } = await (supabase as any)
      .from("custom_fields")
      .select("*")
      .eq("organization_id", organizationId)
      .order("name", { ascending: true });
    if (error) throw error;
    return (data || []).map(rowToCustomField);
  },
  async create(
    data: Omit<CustomField, "id" | "usageCount" | "createdBy" | "scope">,
    organizationId: string | null | undefined,
    options?: CreateCustomFieldOptions
  ): Promise<CustomField> {
    const orgId = requireOrganizationId(organizationId);
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr) throw userErr;
    const uid = userData.user?.id;
    if (!uid) throw new Error("You must be signed in to create a custom field.");

    const orgWide = Boolean(options?.orgWide);
    const payload: Record<string, unknown> = {
      name: data.name,
      type: data.type,
      applies_to: data.appliesTo,
      required: data.required,
      active: data.active,
      default_value: data.defaultValue,
      dropdown_options: data.dropdownOptions,
      organization_id: orgId,
      created_by: orgWide ? null : uid,
    };

    const { data: result, error } = await (supabase as any)
      .from("custom_fields")
      .insert(payload)
      .select()
      .single();
    if (error) throw friendlyCustomFieldError(error);
    return rowToCustomField(result);
  },
  async update(
    id: string,
    data: Partial<Omit<CustomField, "id" | "createdBy" | "scope">>,
    organizationId: string | null | undefined
  ): Promise<CustomField> {
    const orgId = requireOrganizationId(organizationId);
    const payload: any = {};
    if (data.name !== undefined) payload.name = data.name;
    if (data.type !== undefined) payload.type = data.type;
    if (data.appliesTo !== undefined) payload.applies_to = data.appliesTo;
    if (data.required !== undefined) payload.required = data.required;
    if (data.active !== undefined) payload.active = data.active;
    if (data.defaultValue !== undefined) payload.default_value = data.defaultValue;
    if (data.dropdownOptions !== undefined) payload.dropdown_options = data.dropdownOptions;

    const { data: result, error } = await (supabase as any)
      .from("custom_fields")
      .update(payload)
      .eq("id", id)
      .eq("organization_id", orgId)
      .select()
      .maybeSingle();
    if (error) throw friendlyCustomFieldError(error);
    if (!result) {
      throw new Error("You don't have permission to modify this custom field.");
    }
    return rowToCustomField(result);
  },
  async delete(id: string, organizationId: string | null | undefined): Promise<void> {
    const orgId = requireOrganizationId(organizationId);
    const { data, error } = await (supabase as any)
      .from("custom_fields")
      .delete()
      .eq("id", id)
      .eq("organization_id", orgId)
      .select("id");
    if (error) throw friendlyCustomFieldError(error);
    if (!data || data.length === 0) {
      throw new Error("You don't have permission to delete this custom field.");
    }
  },
};

// ==================== LEAD SOURCES ====================

function rowToLeadSource(row: any): LeadSource {
  // Lead sources are denormalized as text on leads.lead_source — usageCount
  // here is the real count from the leads table, not the stale
  // lead_sources.usage_count column. See AGENT_RULES.md §5.
  const real = row.real_usage_count;
  const realNum = typeof real === "number" ? real : Number(real ?? 0);
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    active: row.active,
    usageCount: Number.isFinite(realNum) ? realNum : 0,
    order: row.sort_order,
  };
}

function friendlyLeadSourceError(err: any): Error { // eslint-disable-line @typescript-eslint/no-explicit-any
  const msg: string = err?.message ?? "";
  const code: string = err?.code ?? "";
  if (code === "23505" || /already exists|unique_violation/i.test(msg)) {
    return new Error("A lead source with this name already exists.");
  }
  return err instanceof Error ? err : new Error(msg || "Unknown error");
}

export const leadSourcesSupabaseApi = {
  async getAll(organizationId: string | null | undefined): Promise<LeadSource[]> {
    if (!organizationId) return [];
    const { data, error } = await (supabase as any).rpc("get_lead_sources_with_usage");
    if (error) throw error;
    return (data || []).map(rowToLeadSource);
  },
  async create(data: Omit<LeadSource, "id" | "usageCount">, organizationId: string | null | undefined): Promise<LeadSource> {
    const orgId = requireOrganizationId(organizationId);
    const { data: result, error } = await (supabase as any)
      .from("lead_sources")
      .insert({
        name: data.name,
        color: data.color,
        active: data.active,
        sort_order: data.order,
        organization_id: orgId,
      })
      .select()
      .single();
    if (error) throw friendlyLeadSourceError(error);
    return rowToLeadSource({ ...result, real_usage_count: 0 });
  },
  async update(id: string, data: Partial<LeadSource>, organizationId: string | null | undefined): Promise<LeadSource> {
    const orgId = requireOrganizationId(organizationId);

    // Name change must go through the rename RPC so leads.lead_source cascades
    // atomically within the same transaction.
    if (data.name !== undefined) {
      const { data: rpcResult, error: rpcError } = await (supabase as any).rpc("rename_lead_source", {
        p_source_id: id,
        p_new_name: data.name,
        p_color: data.color ?? null,
      });
      if (rpcError) throw friendlyLeadSourceError(rpcError);
      const row = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
      // Side-effect updates (active/order) only when explicitly requested.
      if (data.active !== undefined || data.order !== undefined) {
        const payload: any = {};
        if (data.active !== undefined) payload.active = data.active;
        if (data.order !== undefined) payload.sort_order = data.order;
        const { error: sideErr } = await (supabase as any)
          .from("lead_sources")
          .update(payload)
          .eq("id", id)
          .eq("organization_id", orgId);
        if (sideErr) throw friendlyLeadSourceError(sideErr);
      }
      return rowToLeadSource({
        id,
        name: row?.new_name ?? data.name,
        color: row?.color ?? data.color ?? "#3B82F6",
        active: data.active ?? true,
        sort_order: data.order ?? 0,
        real_usage_count: row?.reassigned_count ?? 0,
      });
    }

    const payload: any = {};
    if (data.color !== undefined) payload.color = data.color;
    if (data.active !== undefined) payload.active = data.active;
    if (data.order !== undefined) payload.sort_order = data.order;

    const { data: result, error } = await (supabase as any)
      .from("lead_sources")
      .update(payload)
      .eq("id", id)
      .eq("organization_id", orgId)
      .select()
      .maybeSingle();
    if (error) throw friendlyLeadSourceError(error);
    return rowToLeadSource({ ...(result ?? {}), id, real_usage_count: 0 });
  },
  async delete(id: string, organizationId: string | null | undefined): Promise<void> {
    const orgId = requireOrganizationId(organizationId);
    const { error } = await (supabase as any)
      .from("lead_sources")
      .delete()
      .eq("id", id)
      .eq("organization_id", orgId);
    if (error) throw friendlyLeadSourceError(error);
  },
  async reassignAndDelete(
    id: string,
    newSourceId: string,
    organizationId: string | null | undefined,
  ): Promise<{ reassigned: number }> {
    requireOrganizationId(organizationId);
    const { data, error } = await (supabase as any).rpc("reassign_and_delete_lead_source", {
      p_source_id: id,
      p_new_source_id: newSourceId,
    });
    if (error) throw friendlyLeadSourceError(error);
    const reassigned = typeof data === "number" ? data : Number(data ?? 0);
    return { reassigned: Number.isFinite(reassigned) ? reassigned : 0 };
  },
  async reorder(ids: string[], organizationId: string | null | undefined): Promise<void> {
    const orgId = requireOrganizationId(organizationId);
    for (let index = 0; index < ids.length; index++) {
      const id = ids[index];
      const { error } = await (supabase as any)
        .from("lead_sources")
        .update({ sort_order: index + 1 })
        .eq("id", id)
        .eq("organization_id", orgId);
      if (error) throw friendlyLeadSourceError(error);
    }
  },
};

// ==================== CONTACT MANAGEMENT SETTINGS ====================

const DEFAULT_CONTACT_MANAGEMENT_SETTINGS = {
  duplicateDetectionRule: "phone_or_email" as const,
  duplicateDetectionScope: "all_agents" as const,
  manualAction: "warn" as const,
  csvAction: "flag" as const,
  requiredFieldsLead: {} as Record<string, boolean>,
  requiredFieldsClient: {} as Record<string, boolean>,
  assignmentMethod: "unassigned" as const,
  assignmentRotation: [] as string[],
  importOverride: false,
  importMethod: "unassigned",
  importRotation: [] as string[],
};

export const contactManagementSettingsSupabaseApi = {
  async getSettings(organizationId: string | null | undefined): Promise<any> {
    if (!organizationId) return null;

    const { data, error } = await (supabase as any)
      .from("contact_management_settings")
      .select("*")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) throw error;

    if (!data) return null;

    return {
      id: data.id,
      organizationId: data.organization_id,
      duplicateDetectionRule: data.duplicate_detection_rule,
      duplicateDetectionScope: data.duplicate_detection_scope,
      manualAction: data.manual_action,
      csvAction: data.csv_action,
      requiredFieldsLead: data.required_fields_lead,
      requiredFieldsClient: data.required_fields_client,
      assignmentMethod: data.assignment_method,
      assignmentSpecificAgentId: data.assignment_specific_agent_id,
      assignmentRotation: data.assignment_rotation,
      importOverride: data.import_override,
      importMethod: data.import_method,
      importSpecificAgentId: data.import_specific_agent_id,
      importRotation: data.import_rotation,
      updatedAt: data.updated_at,
    };
  },
  async updateSettings(organizationId: string | null | undefined, data: any): Promise<void> {
    const orgId = requireOrganizationId(organizationId);
    const payload: any = { organization_id: orgId };
    if (data.duplicateDetectionRule !== undefined) payload.duplicate_detection_rule = data.duplicateDetectionRule;
    if (data.duplicateDetectionScope !== undefined) payload.duplicate_detection_scope = data.duplicateDetectionScope;
    if (data.manualAction !== undefined) payload.manual_action = data.manualAction;
    if (data.csvAction !== undefined) payload.csv_action = data.csvAction;
    if (data.requiredFieldsLead !== undefined) payload.required_fields_lead = data.requiredFieldsLead;
    if (data.requiredFieldsClient !== undefined) payload.required_fields_client = data.requiredFieldsClient;
    if (data.assignmentMethod !== undefined) payload.assignment_method = data.assignmentMethod;
    if (data.assignmentSpecificAgentId !== undefined) payload.assignment_specific_agent_id = data.assignmentSpecificAgentId;
    if (data.assignmentRotation !== undefined) payload.assignment_rotation = data.assignmentRotation;
    if (data.importOverride !== undefined) payload.import_override = data.importOverride;
    if (data.importMethod !== undefined) payload.import_method = data.importMethod;
    if (data.importSpecificAgentId !== undefined) payload.import_specific_agent_id = data.importSpecificAgentId;
    if (data.importRotation !== undefined) payload.import_rotation = data.importRotation;
    payload.updated_at = new Date().toISOString();

    const { error } = await (supabase as any)
      .from("contact_management_settings")
      .upsert(payload, { onConflict: "organization_id" });

    if (error) throw error;
  },
  getDefaultSettings(organizationId: string) {
    return {
      id: "",
      organizationId,
      ...DEFAULT_CONTACT_MANAGEMENT_SETTINGS,
      updatedAt: new Date().toISOString(),
    };
  },
};
