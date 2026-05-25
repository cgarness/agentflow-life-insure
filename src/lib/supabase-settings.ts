
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
  };
}

export type CreateCustomFieldOptions = {
  /** Admin / Team Leader only: org-wide template (created_by NULL) */
  orgWide?: boolean;
};

export const customFieldsSupabaseApi = {
  /** Pass organizationId so the query is scoped even if JWT claims lag; RLS still enforces access. */
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
    data: Omit<CustomField, "id" | "usageCount" | "createdBy">,
    organizationId: string | null = null,
    options?: CreateCustomFieldOptions
  ): Promise<CustomField> {
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
      organization_id: organizationId,
      created_by: orgWide ? null : uid,
    };

    const { data: result, error } = await (supabase as any)
      .from("custom_fields")
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return rowToCustomField(result);
  },
  async update(id: string, data: Partial<CustomField>): Promise<CustomField> {
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
      .select()
      .single();
    if (error) throw error;
    return rowToCustomField(result);
  },
  async delete(id: string): Promise<void> {
    const { error } = await (supabase as any)
      .from("custom_fields")
      .delete()
      .eq("id", id);
    if (error) throw error;
  },
};

// ==================== LEAD SOURCES ====================

function rowToLeadSource(row: any): LeadSource {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    active: row.active,
    usageCount: row.usage_count,
    order: row.sort_order,
  };
}

export const leadSourcesSupabaseApi = {
  async getAll(organizationId: string | null | undefined): Promise<LeadSource[]> {
    if (!organizationId) return [];
    const { data, error } = await (supabase as any)
      .from("lead_sources")
      .select("*")
      .eq("organization_id", organizationId)
      .order("sort_order", { ascending: true });
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
    if (error) throw error;
    return rowToLeadSource(result);
  },
  async update(id: string, data: Partial<LeadSource>, organizationId: string | null | undefined): Promise<LeadSource> {
    const orgId = requireOrganizationId(organizationId);
    const payload: any = {};
    if (data.name !== undefined) payload.name = data.name;
    if (data.color !== undefined) payload.color = data.color;
    if (data.active !== undefined) payload.active = data.active;
    if (data.order !== undefined) payload.sort_order = data.order;

    const { data: result, error } = await (supabase as any)
      .from("lead_sources")
      .update(payload)
      .eq("id", id)
      .eq("organization_id", orgId)
      .select()
      .single();
    if (error) throw error;
    return rowToLeadSource(result);
  },
  async delete(id: string, organizationId: string | null | undefined): Promise<void> {
    const orgId = requireOrganizationId(organizationId);
    const { error } = await (supabase as any)
      .from("lead_sources")
      .delete()
      .eq("id", id)
      .eq("organization_id", orgId);
    if (error) throw error;
  },
  /**
   * @deprecated Not implemented — does not reassign leads before delete. Build 2+.
   * Do not call from UI.
   */
  async reassignAndDelete(_id: string, _newSourceId: string, _organizationId: string | null | undefined): Promise<{ reassigned: number }> {
    throw new Error("Lead source reassignment is not implemented yet. Deactivate the source instead.");
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
      if (error) throw error;
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
