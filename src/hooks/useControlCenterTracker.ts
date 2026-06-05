import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useIsPlatformAdmin } from "@/hooks/useIsPlatformAdmin";
import type {
  IssueFormValues,
  ItemFormValues,
  MarketingClaimFormValues,
  SystemFormValues,
} from "@/lib/control-center/trackerSchema";
import type {
  TrackerIssue,
  TrackerItem,
  TrackerMarketingClaim,
  TrackerReference,
  TrackerSystem,
} from "@/lib/control-center/trackerTypes";

const SYSTEMS_TABLE = "control_center_tracker_systems";
const ITEMS_TABLE = "control_center_tracker_items";
const ISSUES_TABLE = "control_center_tracker_issues";
const CLAIMS_TABLE = "control_center_tracker_marketing_claims";
const REFS_TABLE = "control_center_tracker_references";

const KEY = {
  systems: ["control-center", "tracker", "systems"] as const,
  items: ["control-center", "tracker", "items"] as const,
  issues: ["control-center", "tracker", "issues"] as const,
  claims: ["control-center", "tracker", "claims"] as const,
  refs: ["control-center", "tracker", "references"] as const,
};

function emptyToNull(v: string | undefined | null): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

// --- Insert/update payload mappers -------------------------------------------

function systemToRow(values: SystemFormValues) {
  return {
    system_key: values.system_key.trim(),
    name: values.name.trim(),
    category: values.category.trim(),
    plain_english_summary: emptyToNull(values.plain_english_summary),
    status: values.status,
    priority: values.priority,
    marketable_status: values.marketable_status,
    owner: emptyToNull(values.owner),
    sort_order: values.sort_order,
    notes: emptyToNull(values.notes),
  };
}

function itemToRow(values: ItemFormValues) {
  return {
    system_id: values.system_id,
    item_key: values.item_key.trim(),
    title: values.title.trim(),
    description: emptyToNull(values.description),
    status: values.status,
    priority: values.priority,
    marketable_status: values.marketable_status,
    production_critical: values.production_critical,
    mobile_visible: values.mobile_visible,
    source_of_truth: emptyToNull(values.source_of_truth),
    next_action: emptyToNull(values.next_action),
    notes: emptyToNull(values.notes),
    sort_order: values.sort_order,
  };
}

function issueToRow(values: IssueFormValues) {
  return {
    issue_key: values.issue_key.trim(),
    title: values.title.trim(),
    description: emptyToNull(values.description),
    severity: values.severity,
    status: values.status,
    system_id: values.system_id ?? null,
    item_id: values.item_id ?? null,
    owner: emptyToNull(values.owner),
    next_action: emptyToNull(values.next_action),
    notes: emptyToNull(values.notes),
    resolved_at:
      values.status === "resolved" ? new Date().toISOString() : null,
  };
}

function claimToRow(values: MarketingClaimFormValues) {
  return {
    claim_key: values.claim_key.trim(),
    feature_claim: values.feature_claim.trim(),
    marketed_location: emptyToNull(values.marketed_location),
    reality_status: values.reality_status,
    actual_status: emptyToNull(values.actual_status),
    action_needed: values.action_needed,
    priority: values.priority,
    system_id: values.system_id ?? null,
    notes: emptyToNull(values.notes),
  };
}

// --- Queries -----------------------------------------------------------------

export function useTrackerSystems() {
  const isPlatformAdmin = useIsPlatformAdmin();
  return useQuery({
    queryKey: KEY.systems,
    enabled: isPlatformAdmin,
    queryFn: async (): Promise<TrackerSystem[]> => {
      const { data, error } = await supabase
        .from(SYSTEMS_TABLE as never)
        .select("*")
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as TrackerSystem[];
    },
  });
}

export function useTrackerItems() {
  const isPlatformAdmin = useIsPlatformAdmin();
  return useQuery({
    queryKey: KEY.items,
    enabled: isPlatformAdmin,
    queryFn: async (): Promise<TrackerItem[]> => {
      const { data, error } = await supabase
        .from(ITEMS_TABLE as never)
        .select("*")
        .order("sort_order", { ascending: true })
        .order("title", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as TrackerItem[];
    },
  });
}

export function useTrackerIssues() {
  const isPlatformAdmin = useIsPlatformAdmin();
  return useQuery({
    queryKey: KEY.issues,
    enabled: isPlatformAdmin,
    queryFn: async (): Promise<TrackerIssue[]> => {
      const { data, error } = await supabase
        .from(ISSUES_TABLE as never)
        .select("*")
        .order("discovered_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as TrackerIssue[];
    },
  });
}

export function useTrackerClaims() {
  const isPlatformAdmin = useIsPlatformAdmin();
  return useQuery({
    queryKey: KEY.claims,
    enabled: isPlatformAdmin,
    queryFn: async (): Promise<TrackerMarketingClaim[]> => {
      const { data, error } = await supabase
        .from(CLAIMS_TABLE as never)
        .select("*")
        .order("priority", { ascending: true })
        .order("feature_claim", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as TrackerMarketingClaim[];
    },
  });
}

export function useTrackerReferences() {
  const isPlatformAdmin = useIsPlatformAdmin();
  return useQuery({
    queryKey: KEY.refs,
    enabled: isPlatformAdmin,
    queryFn: async (): Promise<TrackerReference[]> => {
      const { data, error } = await supabase
        .from(REFS_TABLE as never)
        .select("*")
        .order("kind", { ascending: true })
        .order("label", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as TrackerReference[];
    },
  });
}

// --- Generic mutation factories ----------------------------------------------

function useCreate<TValues, TRow>(
  table: string,
  queryKey: readonly unknown[],
  mapper: (v: TValues) => Record<string, unknown>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: TValues) => {
      const { data, error } = await supabase
        .from(table as never)
        .insert(mapper(values) as never)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return data as unknown as TRow | null;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });
}

function useUpdate<TValues, TRow>(
  table: string,
  queryKey: readonly unknown[],
  mapper: (v: TValues) => Record<string, unknown>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; values: TValues }) => {
      const { data, error } = await supabase
        .from(table as never)
        .update(mapper(args.values) as never)
        .eq("id", args.id)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return data as unknown as TRow | null;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });
}

function useDelete(table: string, queryKey: readonly unknown[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from(table as never).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });
}

// --- Systems -----------------------------------------------------------------
export const useCreateTrackerSystem = () =>
  useCreate<SystemFormValues, TrackerSystem>(SYSTEMS_TABLE, KEY.systems, systemToRow);
export const useUpdateTrackerSystem = () =>
  useUpdate<SystemFormValues, TrackerSystem>(SYSTEMS_TABLE, KEY.systems, systemToRow);
export const useDeleteTrackerSystem = () => useDelete(SYSTEMS_TABLE, KEY.systems);

// --- Items -------------------------------------------------------------------
export const useCreateTrackerItem = () =>
  useCreate<ItemFormValues, TrackerItem>(ITEMS_TABLE, KEY.items, itemToRow);
export const useUpdateTrackerItem = () =>
  useUpdate<ItemFormValues, TrackerItem>(ITEMS_TABLE, KEY.items, itemToRow);
export const useDeleteTrackerItem = () => useDelete(ITEMS_TABLE, KEY.items);

// --- Issues ------------------------------------------------------------------
export const useCreateTrackerIssue = () =>
  useCreate<IssueFormValues, TrackerIssue>(ISSUES_TABLE, KEY.issues, issueToRow);
export const useUpdateTrackerIssue = () =>
  useUpdate<IssueFormValues, TrackerIssue>(ISSUES_TABLE, KEY.issues, issueToRow);
export const useDeleteTrackerIssue = () => useDelete(ISSUES_TABLE, KEY.issues);

// --- Marketing claims --------------------------------------------------------
export const useCreateTrackerClaim = () =>
  useCreate<MarketingClaimFormValues, TrackerMarketingClaim>(
    CLAIMS_TABLE,
    KEY.claims,
    claimToRow,
  );
export const useUpdateTrackerClaim = () =>
  useUpdate<MarketingClaimFormValues, TrackerMarketingClaim>(
    CLAIMS_TABLE,
    KEY.claims,
    claimToRow,
  );
export const useDeleteTrackerClaim = () => useDelete(CLAIMS_TABLE, KEY.claims);
